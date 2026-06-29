import { useUser } from '@clerk/clerk-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// Formats a Clerk createdAt date to a short "Jun 28, 2026" day label.
function fmtDay(d: Date | null | undefined): string {
  if (!d) return '-'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Account: an at-a-glance HearthShelf-style account card. Clerk owns deep
 * identity (the Profile & sign-in tab has email, password, devices, connected
 * accounts), so this is the light, read-only summary - display name, email,
 * account type, member-since - read from Clerk's useUser plus the active server.
 */
export function AccountSettings() {
  const { user, isLoaded } = useUser()
  const { server, servers } = useActiveServer()

  if (!isLoaded) return <LoadingSpinner className="py-12" label="Loading account..." />
  if (!user) return null

  const displayName =
    user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'You'
  const email = user.primaryEmailAddress?.emailAddress ?? 'Not set'
  const memberSince = fmtDay(user.createdAt)
  // In the hosted front door everyone is a HearthShelf account holder; the role
  // hint comes from the active linked server when present.
  const accountType =
    server?.role === 'admin' ? 'Server admin' : 'HearthShelf account'

  const rows: [string, string, string][] = [
    ['person', 'Display name', displayName],
    ['email', 'Email', email],
    ['badge', 'Account type', accountType],
    ['calendar_today', 'Member since', memberSince],
    [
      'dns',
      'Linked servers',
      servers.length === 1 ? '1 server' : `${servers.length} servers`,
    ],
  ]

  return (
    <section>
      <div className="section-head">
        <Icon name="person" />
        <h2>Account</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        A quick look at your HearthShelf account. Manage email, password and
        sign-in in the Profile &amp; sign-in tab.
      </p>

      <div className="cfg-card">
        {rows.map(([icon, label, value]) => (
          <div className="cfg-line" key={label}>
            <Icon name={icon} style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{label}</div>
            </div>
            <span style={{ color: 'var(--text-muted)' }}>{value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
