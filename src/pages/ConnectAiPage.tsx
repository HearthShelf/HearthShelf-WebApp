import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { MCP_ORIGIN } from '@/lib/config'

/**
 * The sign-in bounce for the MCP server's OAuth flow:
 *   /connect-ai?mcp_state=<b64>&mcp_callback=<url>&client_name=<name>
 *
 * An AI client (Claude, etc.) sent the user to mcp.hearthshelf.com/authorize,
 * which needs a signed-in Clerk identity but has no session of its own. It
 * redirects here; this route sits behind RequireAuth, so by the time we render,
 * Clerk has signed the user in (or signed them up) and returned them here.
 *
 * All we do is hand the MCP Worker a Clerk session token by auto-POSTing a form
 * to `mcp_callback`. The Worker verifies it, shows its own consent screen, and
 * completes the OAuth grant. The token travels in a POST BODY, never a query
 * string, so it stays out of history, logs and referrers.
 *
 * We use the 'hearthshelf' JWT template (same as ClerkTokenBridge) because the
 * MCP Worker requires the verified-email and username claims that the default
 * session token does not carry.
 *
 * The callback URL is validated against the known MCP origin before we post to
 * it - it arrives as a query param, so treating it as trusted would let any
 * link harvest a session token.
 */
const JWT_TEMPLATE = 'hearthshelf'

export function ConnectAiPage() {
  const [params] = useSearchParams()
  const { getToken, isLoaded } = useAuth()
  const formRef = useRef<HTMLFormElement>(null)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const state = params.get('mcp_state') ?? ''
  const callback = params.get('mcp_callback') ?? ''
  const clientName = params.get('client_name') || 'An AI client'

  // Only ever post to the MCP Worker itself.
  const callbackOk = (() => {
    if (!callback) return false
    try {
      return new URL(callback).origin === new URL(MCP_ORIGIN).origin
    } catch {
      return false
    }
  })()

  useEffect(() => {
    if (!isLoaded || !state || !callbackOk) return
    let cancelled = false
    void (async () => {
      try {
        const t = await getToken({ template: JWT_TEMPLATE })
        if (cancelled) return
        if (!t) {
          setError('Could not get a session token. Try signing in again.')
          return
        }
        setToken(t)
      } catch {
        if (!cancelled) setError('Could not get a session token. Try signing in again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoaded, state, callbackOk, getToken])

  // Submit as soon as the token lands.
  useEffect(() => {
    if (token) formRef.current?.submit()
  }, [token])

  if (!state || !callbackOk) {
    return (
      <Centered>
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          This link is missing or has an invalid destination. Start the connection again from your
          AI client.
        </p>
      </Centered>
    )
  }

  if (error) {
    return (
      <Centered>
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </Centered>
    )
  }

  return (
    <Centered>
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Connecting {clientName} to HearthShelf...</p>
      <form ref={formRef} method="POST" action={callback} className="hidden">
        <input type="hidden" name="mcp_state" value={state} />
        <input type="hidden" name="clerk_token" value={token ?? ''} />
      </form>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">{children}</div>
    </div>
  )
}
