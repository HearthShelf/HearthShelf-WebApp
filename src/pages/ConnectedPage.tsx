import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { setAbsToken } from '@/lib/absTokens'

/**
 * Full-page fallback landing for the OIDC connect bounce (used when popups are
 * blocked, so the relay redirects the top window here with the token in the URL
 * fragment). We match the `state` against the attempt we stashed before leaving,
 * store the ABS token for that server, and continue into the server view. The
 * primary path is popup + postMessage, which never lands here.
 *
 * The token arrives in the fragment (`#token=...&state=...`) so it is never sent
 * to a server or written to logs; we strip it from the URL immediately.
 */
export function ConnectedPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const token = frag.get('token') || ''
    const state = frag.get('state') || ''
    // Clear the fragment from the address bar right away.
    window.history.replaceState(null, '', window.location.pathname)

    let pending: { serverId: string; serverUrl: string; state: string } | null = null
    try {
      const raw = sessionStorage.getItem('hs-connect-pending')
      pending = raw ? JSON.parse(raw) : null
      sessionStorage.removeItem('hs-connect-pending')
    } catch {
      pending = null
    }

    if (!token || !pending || pending.state !== state) {
      setError('We could not complete the connection. Please try again.')
      return
    }
    setAbsToken(pending.serverId, token)
    navigate(`/server/${pending.serverId}`, { replace: true })
  }, [navigate])

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="text-destructive" size={28} />
          <p className="t-body text-card-foreground">{error}</p>
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
          <p className="t-body">Finishing sign-in...</p>
        </div>
      )}
    </div>
  )
}
