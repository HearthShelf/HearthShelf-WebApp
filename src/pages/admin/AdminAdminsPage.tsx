import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, UserPlus, X, ShieldCheck } from 'lucide-react'
import {
  fetchPlatformAdmins,
  addPlatformAdmin,
  removePlatformAdmin,
  type PlatformAdminEntry,
} from '@/api/controlPlane'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'

/**
 * Platform-admin roster. Add an admin by email (their clerk_user_id is backfilled
 * on first sign-in, like the migration seed) and remove one. The control plane
 * refuses removing the last admin or yourself, so those errors surface as toasts.
 */
export function AdminAdminsPage() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [pendingRemove, setPendingRemove] = useState<PlatformAdminEntry | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-admins'],
    queryFn: fetchPlatformAdmins,
  })

  const add = useMutation({
    mutationFn: () => addPlatformAdmin({ email: email.trim() }),
    onSuccess: () => {
      notify.success('Admin added')
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['admin-admins'] })
    },
    onError: (e) => notify.error(notify.fromError(e, 'Could not add admin')),
  })

  const remove = useMutation({
    mutationFn: (clerkUserId: string) => removePlatformAdmin(clerkUserId),
    onSuccess: () => {
      notify.success('Admin removed')
      setPendingRemove(null)
      void qc.invalidateQueries({ queryKey: ['admin-admins'] })
    },
    onError: (e) => notify.error(notify.fromError(e, 'Could not remove admin')),
  })

  const emailValid = email.trim().includes('@')

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (emailValid) add.mutate()
        }}
        className="flex items-center gap-2"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          className="t-body flex-1 rounded-md border border-border bg-card px-3 py-2 text-[14px] placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" disabled={!emailValid || add.isPending}>
          <UserPlus size={14} />
          {add.isPending ? 'Adding...' : 'Add admin'}
        </Button>
      </form>
      <p className="t-muted mt-2 text-[12px]">
        They get access on their next sign-in. Seeded by email; the Clerk id fills in
        automatically once they authenticate.
      </p>

      <div className="mt-6">
        {isLoading ? (
          <Panel>
            <Loader2 className="animate-spin" size={18} />
            <span className="t-body">Loading admins...</span>
          </Panel>
        ) : error ? (
          <Panel>
            <AlertTriangle size={18} className="text-destructive" />
            <span className="t-body">
              Could not load admins: {error instanceof Error ? error.message : 'unknown error'}
            </span>
          </Panel>
        ) : (
          <ul className="grid gap-1">
            {(data ?? []).map((a) => (
              <li
                key={a.clerk_user_id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <ShieldCheck size={15} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-card-foreground">
                    {a.email || '(no email on file)'}
                    {a.role !== 'admin' ? ` - ${a.role}` : ''}
                  </span>
                  <span className="t-mono block truncate text-[12px] text-muted-foreground">
                    {a.clerk_user_id.startsWith('seed:') ? 'pending first sign-in' : a.clerk_user_id}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setPendingRemove(a)}
                  className="t-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:text-destructive"
                  title="Remove admin"
                >
                  <X size={14} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title="Remove this admin?"
          message={
            <>
              {pendingRemove.email || pendingRemove.clerk_user_id} will lose platform-admin
              access immediately.
            </>
          }
          confirmLabel="Remove"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(pendingRemove.clerk_user_id)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
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
