import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { mintGrant } from '@/api/controlPlane'

/**
 * On-box sign-in bounce. A user who opened a server's OWN page directly (not
 * signed into Clerk) is sent here by the box's "Sign in with HearthShelf" button:
 *   <box>/login -> app.hearthshelf.com/connect-box?server=<serverId>
 * This route requires Clerk auth (RequireAuth wraps it), so by the time it runs
 * the user is signed in. We mint a server-scoped grant and redirect the browser
 * BACK to that server with the grant in the URL FRAGMENT (never the query - so it
 * isn't logged), where the box's /hs/hosted/connect-land page redeems it.
 *
 * Security: we do NOT trust a return URL from the box. The redirect target is the
 * server's own public_url as the CONTROL PLANE knows it (from the user's linked
 * server list) - so this can never be turned into an open redirect, and the grant
 * is aud-pinned to the server anyway.
 */
export function ConnectBoxPage() {
  const [params] = useSearchParams()
  const serverId = params.get('server') || ''
  const { data: servers, isLoading, isError } = useServers()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    if (isLoading) return
    if (!serverId) {
      setError('Missing server.')
      return
    }
    if (isError || !servers) {
      setError('Could not load your servers.')
      return
    }
    const server = servers.find((s) => s.id === serverId)
    if (!server) {
      // The signed-in user isn't linked to this server - nothing to grant.
      setError('You are not linked to this server.')
      return
    }
    ran.current = true
    void (async () => {
      try {
        const { grant } = await mintGrant(serverId)
        const origin = server.url.replace(/\/$/, '')
        // Grant in the fragment so it never hits a server log or referrer.
        // /connect-land is an SPA route on the box (NOT under /hs/, which nginx
        // proxies to the backend).
        window.location.replace(
          `${origin}/connect-land#grant=${encodeURIComponent(grant)}`
        )
      } catch {
        setError('Could not start sign-in. Please try again.')
      }
    })()
  }, [serverId, servers, isLoading, isError])

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="text-destructive" size={28} />
          <p className="t-body text-card-foreground">{error}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="animate-spin" size={24} />
          <p className="t-body">Signing you in to your server...</p>
        </div>
      )}
    </div>
  )
}
