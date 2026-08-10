import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Cloud, ExternalLink, Loader2, Store, X } from 'lucide-react'
import {
  fetchAppReviewQueue,
  fetchStoreApps,
  reviewApp,
  type AppSummary,
  type AppScope,
} from '@/api/controlPlane'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'

/**
 * App store review.
 *
 * WHAT REVIEW IS ACTUALLY FOR, since it governs how much care each decision
 * deserves: a listed app is ONE deployment, run by its developer, that any user
 * can connect. A single compromised credential there reaches every user who
 * connected it. That is the whole reason cloud apps are reviewed and self-hosted
 * apps are not - a self-hosted app is a separate install per user, authorizable
 * only by the person running it, so it never reaches strangers and has nothing
 * to list.
 *
 * So the question when approving is not "is this app good" but "do I trust this
 * developer with a credential that can reach many people's libraries".
 *
 * Approve and unlist are deliberately asymmetric. Unlisting removes an app from
 * the store but does NOT revoke the connections people already granted it -
 * delisting is not a mass revocation, and treating it as one would break working
 * setups over what is usually a curation decision. To actually cut an app off,
 * delete it (which does cascade), or let each user revoke it themselves.
 */

const SCOPE_TEXT: Record<AppScope, string> = {
  'library:read': 'Read library',
  'library:write': 'Write library',
  'progress:read': 'Read progress',
  'progress:write': 'Write progress',
  admin: 'Administer server',
}

export function AdminAppsPage() {
  const qc = useQueryClient()
  const [rejecting, setRejecting] = useState<AppSummary | null>(null)
  const [reason, setReason] = useState('')
  const [unlisting, setUnlisting] = useState<AppSummary | null>(null)

  const queue = useQuery({ queryKey: ['admin-app-queue'], queryFn: fetchAppReviewQueue })
  const listed = useQuery({ queryKey: ['admin-app-listed'], queryFn: fetchStoreApps })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-app-queue'] })
    void qc.invalidateQueries({ queryKey: ['admin-app-listed'] })
    // The public store reads the same rows, so keep it honest too.
    void qc.invalidateQueries({ queryKey: ['store-apps'] })
  }

  const decide = useMutation({
    mutationFn: (v: { appId: string; action: 'approve' | 'reject' | 'unlist'; reason?: string }) =>
      reviewApp(v.appId, v.action, v.reason),
    onSuccess: (_data, v) => {
      notify.success(
        v.action === 'approve'
          ? 'App listed in the store'
          : v.action === 'unlist'
            ? 'App removed from the store'
            : 'Submission rejected',
      )
      setRejecting(null)
      setUnlisting(null)
      setReason('')
      refresh()
    },
    onError: (e) => notify.error(notify.fromError(e, 'Could not update that app')),
  })

  return (
    <div className="grid gap-8">
      <section>
        <h2 className="t-h2">Awaiting review</h2>
        <p className="t-muted mt-1 text-[12px]">
          Hosted services asking to be listed. Approving lets any user connect them.
        </p>

        <div className="mt-3">
          {queue.isLoading ? (
            <Panel>
              <Loader2 className="animate-spin" size={18} />
              <span className="t-body">Loading submissions...</span>
            </Panel>
          ) : queue.error ? (
            <Panel>
              <AlertTriangle size={18} className="text-destructive" />
              <span className="t-body">
                Could not load submissions:{' '}
                {queue.error instanceof Error ? queue.error.message : 'unknown error'}
              </span>
            </Panel>
          ) : !queue.data?.length ? (
            <Panel>
              <Check size={18} className="text-muted-foreground" />
              <span className="t-body">Nothing waiting for review.</span>
            </Panel>
          ) : (
            <ul className="grid gap-2">
              {queue.data.map((app) => (
                <li key={app.app_id} className="rounded-md border border-border bg-card p-3">
                  <AppHeader app={app} />
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ appId: app.app_id, action: 'approve' })}
                    >
                      <Check size={14} />
                      Approve
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setReason('')
                        setRejecting(app)
                      }}
                      disabled={decide.isPending}
                      className="t-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:text-destructive disabled:opacity-50"
                    >
                      <X size={14} />
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="t-h2">In the store</h2>
        <p className="t-muted mt-1 text-[12px]">
          Removing an app from the store hides it from new users. It does not disconnect anyone
          already using it.
        </p>

        <div className="mt-3">
          {listed.isLoading ? (
            <Panel>
              <Loader2 className="animate-spin" size={18} />
              <span className="t-body">Loading store...</span>
            </Panel>
          ) : !listed.data?.length ? (
            <Panel>
              <Store size={18} className="text-muted-foreground" />
              <span className="t-body">The store is empty.</span>
            </Panel>
          ) : (
            <ul className="grid gap-2">
              {listed.data.map((app) => (
                <li key={app.app_id} className="rounded-md border border-border bg-card p-3">
                  <AppHeader app={app} />
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setUnlisting(app)}
                      disabled={decide.isPending}
                      className="t-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:text-destructive disabled:opacity-50"
                    >
                      <X size={14} />
                      Remove from store
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {rejecting && (
        <ConfirmDialog
          title="Reject this submission?"
          message={
            <div className="grid gap-2">
              <span>
                {rejecting.name} stays available to its own developer, but will not be listed.
              </span>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (shown to the developer)"
                className="t-body rounded-md border border-border bg-background px-3 py-2 text-[14px] placeholder:text-muted-foreground"
              />
            </div>
          }
          confirmLabel="Reject"
          busy={decide.isPending}
          onConfirm={() =>
            decide.mutate({
              appId: rejecting.app_id,
              action: 'reject',
              reason: reason.trim() || undefined,
            })
          }
          onCancel={() => setRejecting(null)}
        />
      )}

      {unlisting && (
        <ConfirmDialog
          title="Remove from the store?"
          message={
            <>
              {unlisting.name} will stop appearing to new users. Anyone who already connected it
              keeps their access - to cut those off, each user revokes it from their own
              connections.
            </>
          }
          confirmLabel="Remove"
          busy={decide.isPending}
          onConfirm={() => decide.mutate({ appId: unlisting.app_id, action: 'unlist' })}
          onCancel={() => setUnlisting(null)}
        />
      )}
    </div>
  )
}

function AppHeader({ app }: { app: AppSummary }) {
  return (
    <div className="flex items-start gap-3">
      <Cloud size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-card-foreground">{app.name}</span>
          {app.homepage_url && (
            <a
              href={app.homepage_url}
              target="_blank"
              rel="noreferrer noopener"
              className="t-muted inline-flex items-center gap-0.5 text-[12px] hover:text-foreground"
            >
              <ExternalLink size={12} />
              site
            </a>
          )}
        </div>
        <span className="t-mono block truncate text-[12px] text-muted-foreground">
          {app.app_id}
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {app.requested_scopes.map((s) => (
            <span
              key={s}
              className={
                'rounded px-1.5 py-0.5 text-[11px] ' +
                (s === 'admin'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {SCOPE_TEXT[s] ?? s}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
      {children}
    </div>
  )
}
