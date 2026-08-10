import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, Check, Loader2, ShieldCheck, Store, Monitor } from 'lucide-react'
import {
  fetchPendingAuthorization,
  approveAuthorization,
  denyAuthorization,
  ApiError,
  type PendingAuthorization,
  type AppScope,
} from '@/api/controlPlane'

/**
 * The consent screen: /connect?code=BCDF-GHJK
 *
 * A third-party app showed the user this code and is polling. Here they see who
 * is asking, what it wants, and - crucially - CHOOSE WHICH SERVERS it may reach.
 *
 * Two things worth knowing when changing this screen:
 *
 *  1. It is not the security boundary. The control plane refuses to even
 *     describe a pending request the user is not entitled to authorize (a
 *     self-hosted app can only be connected by the account running it), so a
 *     lookalike app never reaches this screen at all. The badges below are
 *     INFORMATIONAL - do not be tempted to make them load-bearing.
 *
 *  2. Approving with no server selected is refused here AND by the API. An
 *     authorization that reaches nothing would leave the user believing they had
 *     connected something.
 */

const SCOPE_TEXT: Record<AppScope, string> = {
  'library:read': 'See your books, series, authors, and covers',
  'library:write': 'Add and update books in your library',
  'progress:read': 'See what you have listened to and how far you got',
  'progress:write': 'Update your listening progress',
  admin: 'Administer your server',
}

export function ConnectAppPage() {
  const [params] = useSearchParams()
  const initialCode = params.get('code') ?? ''

  const [code, setCode] = useState(initialCode)
  const [pending, setPending] = useState<PendingAuthorization | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)

  const load = async (value: string) => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchPendingAuthorization(value)
      setPending(data)
      // Pre-select when there is only one server: with a single choice the
      // selection is not a decision, and making them tick it adds nothing.
      if (data.servers.length === 1) setSelected([data.servers[0].id])
    } catch (err) {
      setPending(null)
      setError(describe(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialCode) void load(initialCode)
    // Only on mount: later loads are driven by the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const approve = async () => {
    if (!pending || selected.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await approveAuthorization({ userCode: code, serverIds: selected })
      setDone('approved')
    } catch (err) {
      setError(describe(err))
    } finally {
      setLoading(false)
    }
  }

  const deny = async () => {
    setLoading(true)
    try {
      await denyAuthorization(code)
      setDone('denied')
    } catch (err) {
      setError(describe(err))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <Centered>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-6 text-center">
          {done === 'approved' ? (
            <>
              <Check className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
              <h1 className="text-lg font-medium">Connected</h1>
              <p className="mt-2 text-sm text-neutral-400">
                You can go back to {pending?.app.name ?? 'the app'} now. Manage or remove this
                connection any time from Account &rsaquo; Connections.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-medium">Not connected</h1>
              <p className="mt-2 text-sm text-neutral-400">
                Nothing was shared. You can close this page.
              </p>
            </>
          )}
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <h1 className="mb-1 text-xl font-medium">Connect an app</h1>
      <p className="mb-5 text-sm text-neutral-400">
        Enter the code the app showed you.
      </p>

      {!pending && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) void load(code.trim())
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BCDF-GHJK"
            autoFocus
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono tracking-widest outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue'}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {pending && (
        <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-medium">{pending.app.name}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                {pending.relationship === 'own_instance' ? (
                  <>
                    <Monitor className="h-3.5 w-3.5" />
                    Your own copy, running on your hardware
                  </>
                ) : (
                  <>
                    <Store className="h-3.5 w-3.5" />
                    Listed in the HearthShelf app store
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-medium text-neutral-300">This app will be able to</h3>
            <ul className="space-y-1.5">
              {pending.scopes.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-neutral-300">
                  <ShieldCheck
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      s === 'admin' ? 'text-amber-400' : 'text-neutral-500'
                    }`}
                  />
                  <span>{SCOPE_TEXT[s] ?? s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-medium text-neutral-300">On which servers?</h3>
            {pending.servers.length === 0 ? (
              <p className="text-sm text-neutral-400">
                You have no servers linked yet, so there is nothing to connect this app to.
              </p>
            ) : (
              <div className="space-y-1.5">
                {pending.servers.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-700"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => void approve()}
              disabled={loading || selected.length === 0}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
            </button>
            <button
              onClick={() => void deny()}
              disabled={loading}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {selected.length === 0 && pending.servers.length > 0 && (
            <p className="mt-2 text-xs text-neutral-500">Choose at least one server to continue.</p>
          )}
        </div>
      )}
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div>{children}</div>
    </div>
  )
}

/** Turn an API error into something a person can act on. */
function describe(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 403:
        return 'This app can only be connected by the account that runs it. If you installed it yourself, sign in as that account.'
      case 404:
        return "That code isn't valid. Check it and try again."
      case 409:
        return 'That code has already been used. Start again from the app.'
      case 410:
        return 'That code expired. Start again from the app to get a new one.'
    }
  }
  return 'Something went wrong. Try again in a moment.'
}
