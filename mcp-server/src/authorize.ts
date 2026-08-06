/**
 * The OAuth authorize + consent surface (the "default handler").
 *
 * This is what makes one-click setup possible. An MCP client (Claude, etc.)
 * discovers this Worker's metadata, registers itself dynamically, and sends the
 * user here. We:
 *
 *   1. Parse the authorization request (OAuthProvider does the OAuth 2.1 work).
 *   2. Bounce the user to the SPA to sign in with Clerk - the identity they
 *      already have. The SPA posts a Clerk session token back to /callback.
 *   3. Show a consent screen naming the client and the exact (read-only) access.
 *   4. On approval, complete the authorization, sealing the Clerk identity into
 *      the grant's encrypted props.
 *
 * The user never types a token or edits a config file. That is the entire
 * product requirement for "1-click setup for Claude".
 *
 * SECURITY NOTE: the consent screen is not decoration. An MCP client name is
 * attacker-controllable via dynamic registration, so we render it as TEXT
 * (escaped), never as markup, and we always show the real redirect host so a
 * user can spot a client that is not the one they think it is.
 */
import { Hono } from 'hono'
import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import type { Env, McpProps } from './types'
import { verifyClerk, AuthError } from './lib/clerk'

export const authorizeApp = new Hono<{ Bindings: Env }>()

/** Escape text for safe interpolation into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Round-trip the OAuth request through the sign-in bounce without server-side
 * state: we base64url the parsed AuthRequest and carry it as a query param.
 * It is not secret (the client sent it) and it is re-validated on the way back
 * by OAuthProvider itself, so there is nothing here worth tampering with.
 */
function encodeState(req: AuthRequest): string {
  const json = JSON.stringify(req)
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeState(state: string): AuthRequest {
  const b64 = state.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as AuthRequest
}

/**
 * GET /authorize - entry point for the MCP client's OAuth flow.
 *
 * We do not have a Clerk session here (this is a fresh browser hop from the MCP
 * client), so we hand off to the SPA's connect page, which signs the user in and
 * POSTs a Clerk token back to /callback.
 */
authorizeApp.get('/authorize', async (c) => {
  let authReq: AuthRequest
  try {
    authReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  } catch (err) {
    return c.text(`invalid_request: ${(err as Error).message}`, 400)
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId)
  if (!client) return c.text('invalid_client', 400)

  // Hand off to the SPA for Clerk sign-in. It returns the user here with a
  // session token. `mcp_state` carries the OAuth request across the bounce.
  const handoff = new URL('/connect-ai', c.env.APP_ORIGIN)
  handoff.searchParams.set('mcp_state', encodeState(authReq))
  handoff.searchParams.set('mcp_callback', `${c.env.MCP_ISSUER}/callback`)
  handoff.searchParams.set('client_name', client.clientName || 'An AI client')
  return c.redirect(handoff.toString(), 302)
})

/**
 * POST /callback - the SPA posts the signed-in user's Clerk token here.
 * Renders the consent screen. No grant exists yet; approval happens next.
 */
authorizeApp.post('/callback', async (c) => {
  const form = await c.req.formData()
  const stateRaw = String(form.get('mcp_state') ?? '')
  const clerkToken = String(form.get('clerk_token') ?? '')
  if (!stateRaw || !clerkToken) return c.text('missing_state_or_token', 400)

  let authReq: AuthRequest
  try {
    authReq = decodeState(stateRaw)
  } catch {
    return c.text('bad_state', 400)
  }

  let identity
  try {
    identity = await verifyClerk(c.env, clerkToken)
  } catch (err) {
    if (err instanceof AuthError) return c.text('unauthorized', 401)
    throw err
  }
  if (!identity.emailVerified) {
    return c.text('email_not_verified', 403)
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId)
  const clientName = client?.clientName || 'An AI client'
  const redirectHost = (() => {
    try {
      return new URL(authReq.redirectUri).host
    } catch {
      return authReq.redirectUri
    }
  })()

  return c.html(
    consentPage({
      clientName,
      redirectHost,
      email: identity.email,
      state: stateRaw,
      clerkToken,
    }),
  )
})

/**
 * POST /approve - the user pressed Connect. Seal the identity into the grant.
 */
authorizeApp.post('/approve', async (c) => {
  const form = await c.req.formData()
  const stateRaw = String(form.get('mcp_state') ?? '')
  const clerkToken = String(form.get('clerk_token') ?? '')
  if (!stateRaw || !clerkToken) return c.text('missing_state_or_token', 400)

  let authReq: AuthRequest
  try {
    authReq = decodeState(stateRaw)
  } catch {
    return c.text('bad_state', 400)
  }

  // Re-verify rather than trusting the hidden field: this POST is a separate
  // request and the token in it is user-supplied like any other input.
  let identity
  try {
    identity = await verifyClerk(c.env, clerkToken)
  } catch (err) {
    if (err instanceof AuthError) return c.text('unauthorized', 401)
    throw err
  }
  if (!identity.emailVerified) return c.text('email_not_verified', 403)

  const props: McpProps = {
    clerkUserId: identity.userId,
    email: identity.email,
    username: identity.username,
    clerkToken,
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: authReq,
    userId: identity.userId,
    metadata: {
      connectedAt: Date.now(),
      clientName: (await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId))?.clientName ?? null,
    },
    // Read-only surface: one scope, no write scope exists to request.
    scope: ['library:read'],
    props,
  })

  return c.redirect(redirectTo, 302)
})

/** The consent screen. Plain, self-contained HTML - no external assets (CSP). */
function consentPage(v: {
  clientName: string
  redirectHost: string
  email: string
  state: string
  clerkToken: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to HearthShelf</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #faf7f2; color: #2b2724; padding: 1.5rem;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1715; color: #ece7e1; }
    .card { background: #241f1c !important; border-color: #3a322d !important; }
    .row { background: #1f1b19 !important; }
  }
  .card {
    background: #fff; border: 1px solid #e6ddd2; border-radius: 1rem;
    padding: 2rem; max-width: 26rem; width: 100%;
    box-shadow: 0 4px 24px rgb(0 0 0 / 0.06);
  }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { line-height: 1.55; margin: 0 0 1rem; font-size: .95rem; }
  .row {
    background: #f7f3ee; border-radius: .6rem; padding: .75rem .9rem;
    font-size: .85rem; margin-bottom: 1rem;
  }
  .row b { font-weight: 600; }
  ul { margin: 0 0 1.25rem; padding-left: 1.1rem; font-size: .9rem; line-height: 1.7; }
  .muted { color: #7a6f66; font-size: .8rem; }
  button {
    width: 100%; padding: .8rem; border: 0; border-radius: .6rem;
    background: #e0654a; color: #fff; font-size: 1rem; font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #cf5a41; }
</style>
</head>
<body>
  <div class="card">
    <h1>Connect ${esc(v.clientName)} to HearthShelf?</h1>
    <p><b>${esc(v.clientName)}</b> wants to read your HearthShelf library so it can
    answer questions about your books.</p>

    <div class="row">
      Signed in as <b>${esc(v.email)}</b><br>
      <span class="muted">Returns to ${esc(v.redirectHost)}</span>
    </div>

    <p><b>It will be able to:</b></p>
    <ul>
      <li>See your libraries and search your books</li>
      <li>See what you have read, finished and rated</li>
      <li>See your recommendations and listening stats</li>
    </ul>
    <p class="muted">Read-only. It cannot change, delete or upload anything, and
    it cannot play audio or see your password.</p>

    <form method="POST" action="/approve">
      <input type="hidden" name="mcp_state" value="${esc(v.state)}">
      <input type="hidden" name="clerk_token" value="${esc(v.clerkToken)}">
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`
}
