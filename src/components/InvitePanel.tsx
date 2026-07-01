import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { useInviteToServer } from '@/hooks/useServers'
import { Button } from '@/components/ui/Button'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/cn'

/**
 * Invite-by-email control for a server. Shown only to admins (the caller gates
 * on role). Mirrors the Plex "invite a friend" flow: enter an email, they get a
 * sign-up link, and they're linked on first sign-in.
 */
export function InvitePanel({ serverId }: { serverId: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const invite = useInviteToServer(serverId)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    invite.mutate(
      { email: trimmed, role },
      {
        onSuccess: (r) => {
          setEmail('')
          notify.success(r.emailed ? `Invited ${r.email} - email sent` : `Invited ${r.email}`)
        },
        // Failures surface via the global mutation error toast.
      },
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <UserPlus size={18} className="text-muted-foreground" />
        <h2 className="t-h2">Invite someone</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        They'll get an email to create a HearthShelf account, then this library appears for them
        automatically.
      </p>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@email.com"
          className={cn(
            'h-10 min-w-[16rem] flex-1 rounded-lg border border-input bg-background px-3',
            'text-[15px] text-foreground placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
          className="h-10 rounded-lg border border-input bg-background px-3 text-[15px] text-foreground"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? 'Sending...' : 'Send invite'}
        </Button>
      </form>
    </div>
  )
}
