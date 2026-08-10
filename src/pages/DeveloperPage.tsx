import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  fetchMyApps,
  createMyApp,
  rotateMyAppSecret,
  deleteMyApp,
  submitMyAppForReview,
  ApiError,
  type AppScope,
} from '@/api/controlPlane'

/**
 * Account > Developer: register your own app.
 *
 * WHO THIS IS FOR - and who it is NOT for. Self-hosted apps that each user runs
 * their own copy of (Audplexus, and any well-behaved Home Assistant integration)
 * REGISTER THEMSELVES on first run. Their users never come here. If a normal
 * user of such an app is ever told to visit this page, that app's integration is
 * doing it the hard way.
 *
 * This page is for two narrower cases:
 *   - someone hand-building a personal script or integration who just wants a
 *     credential without shipping self-registration;
 *   - a developer registering a HOSTED service (one deployment serving many
 *     users), which must be reviewed before anyone else can connect it.
 */

const SCOPE_TEXT: Record<AppScope, string> = {
  'library:read': 'Read the library',
  'library:write': 'Add and update books',
  'progress:read': 'Read listening progress',
  'progress:write': 'Update listening progress',
  admin: 'Administer the server',
}
const ALL_SCOPES = Object.keys(SCOPE_TEXT) as AppScope[]

export function DeveloperPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'instance' | 'cloud'>('instance')
  const [scopes, setScopes] = useState<AppScope[]>(['library:read'])
  const [secret, setSecret] = useState<{ appId: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, isLoading, isError } = useQuery({ queryKey: ['my-apps'], queryFn: fetchMyApps })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-apps'] })

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await createMyApp({ name: name.trim(), kind, scopes })
      // Shown once and never retrievable again - only rotatable.
      setSecret({ appId: res.app.app_id, value: res.client_secret })
      setName('')
      setScopes(['library:read'])
      setCreating(false)
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'You have created a lot of apps recently. Try again later.'
          : 'Could not create that app.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
      </div>
    )
  }
  if (isError) return null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Developer</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Register an app that connects to HearthShelf servers.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-600"
        >
          <Plus className="h-4 w-4" />
          New app
        </button>
      </div>

      {secret && (
        <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3">
          <p className="text-sm text-emerald-200">Copy this secret now - it is not shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-neutral-900 px-2 py-1.5 font-mono text-xs">
              {secret.value}
            </code>
            <button
              onClick={() => void navigator.clipboard.writeText(secret.value)}
              className="rounded border border-neutral-700 p-1.5 hover:border-neutral-600"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 font-mono text-xs text-neutral-400">app_id: {secret.appId}</p>
          <button
            onClick={() => setSecret(null)}
            className="mt-2 text-xs text-neutral-400 underline"
          >
            I've copied it
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {creating && (
        <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="App name"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <div className="flex gap-2">
            {(['instance', 'cloud'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-md border px-3 py-2 text-left text-xs ${
                  kind === k
                    ? 'border-neutral-500 bg-neutral-800'
                    : 'border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <span className="block font-medium">
                  {k === 'instance' ? 'Self-hosted' : 'Hosted service'}
                </span>
                <span className="text-neutral-400">
                  {k === 'instance'
                    ? 'Each user runs their own copy. Only you can connect it.'
                    : 'One deployment, many users. Needs review to be listed.'}
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes((prev) =>
                      e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                    )
                  }
                />
                <span className={s === 'admin' ? 'text-amber-300' : ''}>{SCOPE_TEXT[s]}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={busy || !name.trim() || scopes.length === 0}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </button>
            <button
              onClick={() => {
                // Reset, not just hide: reopening the form half-filled with a
                // previous abandoned attempt is confusing.
                setCreating(false)
                setName('')
                setScopes(['library:read'])
                setError(null)
              }}
              disabled={busy}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!data?.length ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-400">
          You have not registered any apps.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((app) => (
            <li
              key={app.app_id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{app.name}</h3>
                  <p className="mt-0.5 font-mono text-xs text-neutral-500">{app.app_id}</p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {app.kind === 'instance' ? 'Self-hosted' : 'Hosted service'} ·{' '}
                    {app.listing_status === 'listed'
                      ? 'In the store'
                      : app.listing_status === 'pending'
                        ? 'Awaiting review'
                        : 'Not listed'}
                  </p>
                  {/* What the app can ask for. Without this the console showed a
                      name and a status but not the one thing that actually
                      matters about a registration. */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {app.requested_scopes.length === 0 ? (
                      <span className="text-xs text-neutral-500">No permissions requested</span>
                    ) : (
                      app.requested_scopes.map((s) => (
                        <span
                          key={s}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            s === 'admin'
                              ? 'bg-amber-950/60 text-amber-300'
                              : 'bg-neutral-800 text-neutral-300'
                          }`}
                        >
                          {SCOPE_TEXT[s] ?? s}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const s = await rotateMyAppSecret(app.app_id)
                        setSecret({ appId: app.app_id, value: s })
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy}
                    className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:border-neutral-600 disabled:opacity-50"
                  >
                    Rotate secret
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete ${app.name}? Anyone using it loses access.`)) return
                      setBusy(true)
                      try {
                        await deleteMyApp(app.app_id)
                        await refresh()
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy}
                    className="rounded-md border border-neutral-700 px-2 py-1.5 text-xs hover:border-red-800 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Only hosted services can be listed: a self-hosted app is software
                  each user runs their own copy of, so there is nothing to list. */}
              {app.kind === 'cloud' && app.listing_status === 'unlisted' && (
                <button
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await submitMyAppForReview(app.app_id)
                      await refresh()
                    } finally {
                      setBusy(false)
                    }
                  }}
                  disabled={busy}
                  className="mt-3 text-xs text-neutral-300 underline disabled:opacity-50"
                >
                  Submit for store review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
