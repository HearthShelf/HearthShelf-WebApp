import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Server, Loader2, Unlink } from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { useServers, useUnlinkServer } from '@/hooks/useServers'
import { Button } from '@/components/ui/Button'
import { notify } from '@/lib/notify'

/**
 * Account page: who you're signed in as, and the servers linked to this account
 * (with unlink). Profile editing stays in Clerk's own UI (UserButton -> Manage
 * account); this page owns the HearthShelf-specific linked-servers management.
 */
export function AccountPage() {
  const { user } = useUser()
  const { data: servers, isLoading } = useServers()
  const unlink = useUnlinkServer()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function doUnlink(id: string, name: string) {
    unlink.mutate(id, {
      onSuccess: () => {
        setConfirmId(null)
        notify.success(`Unlinked ${name}`)
      },
      onError: (e) => notify.error(notify.fromError(e, 'Could not unlink')),
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/"
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Your servers
      </Link>

      <p className="t-eyebrow">Account</p>
      <h1 className="t-h1 mt-1">{user?.fullName || user?.username || 'Your account'}</h1>
      {user?.primaryEmailAddress && (
        <p className="t-mono mt-1">{user.primaryEmailAddress.emailAddress}</p>
      )}
      <p className="t-muted mt-2 text-[13px]">
        Manage your profile and sign-in from the account menu in the top bar.
      </p>

      <div className="mt-8">
        <h2 className="t-h2 mb-3">Linked servers</h2>
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} />
            <span className="t-body">Loading...</span>
          </div>
        ) : !servers || servers.length === 0 ? (
          <p className="t-muted text-[13px]">No servers linked.</p>
        ) : (
          <ul className="grid gap-3">
            {servers.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
              >
                <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Server size={18} />
                </span>
                <span className="flex-1">
                  <span className="block font-medium text-card-foreground">{s.name}</span>
                  <span className="t-mono block">{s.url}</span>
                </span>
                {confirmId === s.id ? (
                  <span className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={unlink.isPending}
                      onClick={() => doUnlink(s.id, s.name)}
                    >
                      {unlink.isPending ? 'Unlinking...' : 'Confirm'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(s.id)}>
                    <Unlink size={15} />
                    Unlink
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
