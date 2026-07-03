import { useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'
import { useActiveServer } from '@/hooks/useActiveServer'

/**
 * App-wide "this server is out of date" prompt.
 *
 * Two audiences, one component:
 *   - Admins (can actually update) get an actionable banner with the version jump
 *     and a link to the release notes / update steps.
 *   - Users (can't update) get a quiet inline notice so a missing feature makes
 *     sense, with no action button.
 *
 * Severity controls how hard it pushes. 'info' shows nothing here (only the chip
 * in Settings). 'recommended' is a soft, dismissible nudge. 'security'/'critical'
 * - and anything below the release's min_supported floor - are sticky and cannot
 * be dismissed. Dismissal is remembered per (server, version) in localStorage so
 * clearing it once doesn't re-nag until the NEXT version ships.
 */
const DISMISS_PREFIX = 'hs.updateDismissed.'

function dismissKey(serverId: string, version: string): string {
  return `${DISMISS_PREFIX}${serverId}:${version}`
}

export function UpdateBanner() {
  const { current, latest, severity, updateAvailable, belowMinSupported, isAdmin } =
    useUpdateStatus()
  const { server } = useActiveServer()
  const [dismissed, setDismissed] = useState(false)

  // Nothing to say: up to date, unknown version, or a silent 'info' release.
  if (!updateAvailable || !latest || !current) return null
  if (severity === 'info') return null

  const sticky = belowMinSupported || severity === 'security' || severity === 'critical'
  const tone = severity === 'critical' ? 'danger' : severity === 'security' ? 'warn' : 'info'

  const storageKey = server ? dismissKey(server.id, latest.version) : null
  const alreadyDismissed =
    !sticky && (dismissed || (storageKey ? localStorage.getItem(storageKey) === '1' : false))
  if (alreadyDismissed) return null

  const dismiss = () => {
    if (storageKey) localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }

  // Non-admins can't update; keep it quiet and actionless.
  if (!isAdmin) {
    return (
      <div className={`banner ${tone}`}>
        <Icon name="info" />
        <span>This server is running an older version of HearthShelf ({`v${current}`}).</span>
      </div>
    )
  }

  const icon = tone === 'danger' ? 'gpp_maybe' : tone === 'warn' ? 'security_update_warning' : 'system_update'
  const lead =
    tone === 'danger'
      ? 'A critical HearthShelf update is available'
      : tone === 'warn'
        ? 'A security update for HearthShelf is available'
        : 'A HearthShelf update is available'

  return (
    <div className={`banner ${tone}`}>
      <Icon name={icon} />
      <span>
        {lead} - you're on <strong>v{current}</strong>, latest is <strong>v{latest.version}</strong>
        {belowMinSupported ? ' (update required to keep this server connected).' : '.'}
      </span>
      <span className="b-actions">
        {latest.notes_url && (
          <a className="b-link" href={latest.notes_url} target="_blank" rel="noreferrer noopener">
            How to update
          </a>
        )}
        {!sticky && (
          <span className="b-x" role="button" title="Dismiss" onClick={dismiss}>
            <Icon name="close" />
          </span>
        )}
      </span>
    </div>
  )
}
