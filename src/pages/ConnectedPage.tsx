import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { setAbsToken } from '@/lib/absTokens'

/**
 * Full-page fallback landing for the OIDC connect bounce (used when popups are
 * blocked, so the relay redirects the top window here with the token in the URL
 * fragment). We confirm a connect attempt was started this session (stashed in
 * sessionStorage before we left), store the ABS token for that server, and
 * continue into the server view. The primary path is popup + postMessage, which
 * never lands here.
 *
 * The token arrives in the fragment (`#token=...`) so it is never sent to a
 * server or written to logs; we strip it from the URL immediately. We don't
 * verify a self-issued state nonce: ABS's web OIDC flow forbids a caller state,
 * so the guard is "we initiated this attempt this session" + the token's origin.
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
    // Clear the fragment from the address bar right away.
    window.history.replaceState(null, '', window.location.pathname)

    let pending: { serverId: string; serverUrl: string } | null = null
    try {
      const raw = sessionStorage.getItem('hs-connect-pending')
      pending = raw ? JSON.parse(raw) : null
      sessionStorage.removeItem('hs-connect-pending')
    } catch {
      pending = null
    }

    if (!token || !pending) {
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
