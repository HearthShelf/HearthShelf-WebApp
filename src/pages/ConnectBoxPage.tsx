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
 * Return target (Plex-style): we send the user BACK to the exact origin they were
 * on (the box passes ?return=<its origin>), so someone who started on the LAN IP
 * stays on the LAN IP. We VALIDATE that return before honoring it: it must be the
 * same server's known public_url host, or a private/LAN/localhost address.
 * Anything else falls back to the server's canonical public_url. The grant is
 * aud-pinned to the server, so even a mistaken host can't redeem it elsewhere -
 * this validation just keeps us from bouncing the browser to an arbitrary site.
 */

// Is this hostname a private/LAN/loopback address (so a box reachable only on the
// LAN can be returned to)? IPv4 RFC1918 + loopback + .local; not exhaustive for
// IPv6 but covers the common self-hosted cases.
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (h === '127.0.0.1' || h.startsWith('127.')) return true
  if (h === '10.' || h.startsWith('10.')) return true
  if (h.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (h === '::1') return true
  return false
}

// Choose where to send the user back. Honor the box-supplied return origin only
// if it's the same server's public host or a private/LAN address; else use the
// server's canonical public_url.
function pickReturnOrigin(returnParam: string | null, serverUrl: string): string {
  const canonical = serverUrl.replace(/\/$/, '')
  if (!returnParam) return canonical
  try {
    const ret = new URL(returnParam)
    if (ret.protocol !== 'https:' && ret.protocol !== 'http:') return canonical
    const serverHost = new URL(canonical).hostname.toLowerCase()
    const retHost = ret.hostname.toLowerCase()
    if (retHost === serverHost || isPrivateHost(retHost)) {
      return `${ret.protocol}//${ret.host}` // origin only - drop any path/query
    }
  } catch {
    // malformed return - fall through to canonical
  }
  return canonical
}
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
        // Return to the origin the user came from (validated), else canonical.
        const origin = pickReturnOrigin(params.get('return'), server.url)
        // Grant in the fragment so it never hits a server log or referrer.
        // /connect-land is an SPA route on the box (NOT under /hs/, which nginx
        // proxies to the backend).
        window.location.replace(`${origin}/connect-land#grant=${encodeURIComponent(grant)}`)
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
