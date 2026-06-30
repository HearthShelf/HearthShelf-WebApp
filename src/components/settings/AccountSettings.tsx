import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { isCarBrowser } from '@/hooks/useCarMode'
import { useSettingsStore } from '@/store/settingsStore'

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

      <AdvancedPanel />
    </section>
  )
}

/**
 * Advanced: collapsed by default, behind a toggle. Surfaces the live browser
 * user-agent (the diagnostic for car-mode auto-detection) plus whether the
 * current UA matches our car-browser pattern, so a mismatch is visible and the
 * pattern can be widened.
 */
function AdvancedPanel() {
  const showAdvanced = useSettingsStore((s) => s.showAdvanced)
  const set = useSettingsStore((s) => s.set)
  const [copied, setCopied] = useState(false)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const detected = isCarBrowser()

  const copyUa = async () => {
    try {
      await navigator.clipboard.writeText(ua)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context / permissions); the UA is still
      // selectable on screen, so this is a soft failure.
    }
  }

  return (
    <>
      <div className="cfg-line" style={{ marginTop: 18, cursor: 'pointer' }} onClick={() => set('showAdvanced', !showAdvanced)}>
        <Icon name="code" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Advanced</div>
          <div className="cl-d">Browser details for troubleshooting.</div>
        </div>
        <Icon
          name={showAdvanced ? 'expand_less' : 'expand_more'}
          style={{ color: 'var(--text-muted)' }}
        />
      </div>

      {showAdvanced && (
        <div className="cfg-card" style={{ marginTop: 10 }}>
          <div className="cfg-line">
            <Icon name="directions_car" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">Car browser detected</div>
              <div className="cl-d">
                Whether this browser's user-agent matches the car-mode pattern.
              </div>
            </div>
            <span style={{ color: detected ? 'var(--ok, #6bbf73)' : 'var(--text-muted)' }}>
              {detected ? 'Yes' : 'No'}
            </span>
          </div>

          <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
            <Icon name="badge" style={{ color: 'var(--text-muted)', marginTop: 2 }} />
            <div className="cl-meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="cl-t">User agent</div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {ua || 'Unavailable'}
              </div>
            </div>
            <button
              className="btn-sm btn-ghost"
              style={{ flex: 'none' }}
              onClick={copyUa}
            >
              <Icon name={copied ? 'check' : 'content_copy'} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
