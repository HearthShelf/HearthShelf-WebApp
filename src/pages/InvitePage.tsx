import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { useActiveServerStore } from '@/store/activeServer'

/**
 * Landing for the branded invite email's deeplink: /invite?server=<serverId>.
 *
 * This route lives behind RequireAuth, so Clerk has already handled new-vs-
 * existing: a signed-out invitee is bounced to sign-in/sign-up and returned
 * here afterward. By the time we render, the user is authenticated and the
 * control plane has materialized any pending invite into a real link on the
 * first GET /servers (see acceptPendingInvites). We just wait for the invited
 * server to appear in the list, then deep-link into its library.
 */
export function InvitePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const serverId = params.get('server') ?? ''
  const { data: servers, isLoading, isError } = useServers()
  const setActiveServer = useActiveServerStore((s) => s.setActiveServer)

  useEffect(() => {
    if (!serverId) {
      navigate('/', { replace: true })
      return
    }
    if (!servers) return
    if (servers.some((s) => s.id === serverId)) {
      // Make the invited server the active one, then land on the clean library -
      // the server id never sticks in the URL.
      setActiveServer(serverId)
      navigate('/library', { replace: true })
    } else {
      // Authed and the list loaded, but this server isn't linked: the invite was
      // for a different email, already revoked, or never materialized. Drop them
      // on the server list rather than a dead end - anything they do have shows.
      navigate('/', { replace: true })
    }
  }, [serverId, servers, navigate, setActiveServer])

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
