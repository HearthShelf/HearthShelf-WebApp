import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, Monitor, Store, Trash2 } from 'lucide-react'
import {
  fetchAppInstallations,
  revokeAppInstallation,
  withdrawAppServer,
  type AppScope,
} from '@/api/controlPlane'
import { useServers } from '@/hooks/useServers'

/**
 * Account > Connections: every app connected to this account.
 *
 * THE HONESTY RULE. This list comes from the control plane's MIRROR, but the
 * SERVER holds the credential that actually grants access. So:
 *
 *   - a revoke that could not be delivered to a server is reported as failed,
 *     and the app is NOT removed from the list;
 *   - the user is told which server could not be reached.
 *
 * Showing "revoked" over an app that still works would be the worst possible
 * outcome for someone trying to cut off something misbehaving. Do not "tidy" the
 * unreachable case away.
 */

const SCOPE_TEXT: Record<AppScope, string> = {
  'library:read': 'Read your library',
  'library:write': 'Add and update books',
  'progress:read': 'Read your progress',
  'progress:write': 'Update your progress',
  admin: 'Administer your server',
}

export function ConnectionsPage() {
  const queryClient = useQueryClient()
  const { data: servers } = useServers()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['app-installations'],
    queryFn: fetchAppInstallations,
  })

  const serverName = (id: string) => servers?.find((s) => s.id === id)?.name ?? id

  const revoke = async (id: string, appName: string) => {
    if (!confirm(`Disconnect ${appName}? It will lose access immediately.`)) return
    setBusy(id)
    setProblem(null)
    try {
      const res = await revokeAppInstallation(id)
      if (!res.ok) {
        // Deliberately explicit: the app is still connected to these servers.
        setProblem(
          `Could not reach ${res.unreachable.map(serverName).join(', ')}, so ${appName} still has access there. Try again when the server is back online.`,
        )
      }
      await queryClient.invalidateQueries({ queryKey: ['app-installations'] })
    } catch {
      setProblem('Could not disconnect that app. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  const withdraw = async (id: string, serverId: string, appName: string) => {
    if (!confirm(`Remove ${serverName(serverId)} from ${appName}?`)) return
    setBusy(id)
    setProblem(null)
    try {
      await withdrawAppServer(id, serverId)
      await queryClient.invalidateQueries({ queryKey: ['app-installations'] })
    } catch {
      setProblem(
        `Could not reach ${serverName(serverId)}, so ${appName} still has access there.`,
      )
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
      </div>
    )
  }

  // Degrade rather than break: a surface that cannot load hides itself.
  if (isError) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connected apps</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Apps you have given access to your servers. Disconnecting takes effect immediately.
        </p>
      </div>

      {problem && (
        <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/40 p-3 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      {!data?.length ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-400">
          Nothing connected yet. Apps you connect will appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.map((install) => (
            <li
              key={install.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{install.app_name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                    {install.kind === 'instance' ? (
                      <>
                        <Monitor className="h-3.5 w-3.5" />
                        Self-hosted{install.family ? ` · ${install.family}` : ''}
                      </>
                    ) : (
                      <>
                        <Store className="h-3.5 w-3.5" />
                        Hosted service
                      </>
                    )}
                    {install.last_seen_at && (
                      <span> · last used {relative(install.last_seen_at)}</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => void revoke(install.id, install.app_name)}
                  disabled={busy === install.id}
                  className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-red-800 hover:text-red-300 disabled:opacity-50"
                >
                  {busy === install.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {install.scopes.map((s) => (
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
                ))}
              </div>

              {install.server_ids.length > 0 && (
                <div className="mt-3 space-y-1">
                  {install.server_ids.map((sid) => (
                    <div
                      key={sid}
                      className="flex items-center justify-between rounded border border-neutral-800/70 px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate text-neutral-300">{serverName(sid)}</span>
                      {install.server_ids.length > 1 && (
                        <button
                          onClick={() => void withdraw(install.id, sid, install.app_name)}
                          disabled={busy === install.id}
                          className="text-neutral-500 hover:text-red-300 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function relative(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
