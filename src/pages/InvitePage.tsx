import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { acceptInvite } from '@/api/controlPlane'
import { useActiveServerStore } from '@/store/activeServer'

/**
 * Landing for the branded invite email's deeplink:
 *   /invite?token=<token>[&server=<serverId>]
 *
 * This route lives behind RequireAuth, so Clerk has already handled new-vs-
 * existing: a signed-out invitee is bounced to sign-in/sign-up and returned
 * here afterward. By the time we render, the user is authenticated.
 *
 * Acceptance is token-driven: we POST the token to the control plane, which
 * links the server to this account regardless of its email. This is what makes
 * invites work for Sign in with Apple "Hide My Email" users, whose account
 * carries a @privaterelay address that never matches the invited email. Once
 * accepted we set the server active and deep-link into its library.
 *
 * Legacy links without a token still work via email matching: the control plane
 * materializes those on the first GET /servers (acceptPendingInvites), so we
 * fall back to waiting for the `?server=` id to appear in the list.
 */
export function InvitePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const token = params.get('token') ?? ''
  const serverId = params.get('server') ?? ''
  const { data: servers, isLoading, isError } = useServers()
  const setActiveServer = useActiveServerStore((s) => s.setActiveServer)
  const [accepting, setAccepting] = useState(token !== '')
  const acceptedOnce = useRef(false)

  // Token path: redeem it, then land on the invited server's library. Runs once.
  useEffect(() => {
    if (!token || acceptedOnce.current) return
    acceptedOnce.current = true
    let cancelled = false
    void (async () => {
      try {
        const { serverId: linked } = await acceptInvite(token)
        if (cancelled) return
        // Refresh the server list so the newly linked server is present before
        // any screen that reads it renders.
        await queryClient.invalidateQueries({ queryKey: ['servers'] })
        setActiveServer(linked)
        navigate('/library', { replace: true })
      } catch {
        // Invalid/expired/already-claimed token, or a transient failure. Fall
        // through to the email-matching path (below) rather than dead-ending.
        if (!cancelled) setAccepting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, queryClient, setActiveServer, navigate])

  // Legacy email-match path (no token, or token accept failed): wait for the
  // invited server to appear in the list.
  useEffect(() => {
    if (accepting) return
    if (!serverId) {
      navigate('/', { replace: true })
      return
    }
    if (!servers) return
    if (servers.some((s) => s.id === serverId)) {
      setActiveServer(serverId)
      navigate('/library', { replace: true })
    } else {
      // Authed and the list loaded, but this server isn't linked: the invite was
      // for a different email, already revoked, or never materialized. Drop them
      // on the server list rather than a dead end - anything they do have shows.
      navigate('/', { replace: true })
    }
  }, [accepting, serverId, servers, navigate, setActiveServer])

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      {isError ? (
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="text-destructive" size={28} />
          <p className="t-body text-card-foreground">
            We could not load your invitation. Please try again.
          </p>
          <button
            className="t-muted text-[13px] underline hover:text-foreground"
            onClick={() => navigate('/', { replace: true })}
          >
            Back to your servers
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="animate-spin" size={24} />
          <p className="t-body">{isLoading ? 'Opening your invitation...' : 'Almost there...'}</p>
        </div>
      )}
    </div>
  )
}
