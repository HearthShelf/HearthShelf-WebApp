import { useRef, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Loader2 } from 'lucide-react'
import { Toggle } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'
import { useSettingsStore } from '@/store/settingsStore'
import { useClerkAvatarSync } from '@/hooks/useClerkAvatarSync'

function fmtDay(d: Date | null | undefined): string {
  if (!d) return '-'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function AccountSettings() {
  const { user, isLoaded } = useUser()
  const { server, servers, target } = useActiveServer()
  const useGravatar = useSettingsStore((s) => s.useGravatar)
  const setSetting = useSettingsStore((s) => s.set)
  // null = never chose, so the default (on) applies; only an explicit false is off.
  const gravatarOn = useGravatar !== false
  const { sync: syncClerkPhoto, syncing } = useClerkAvatarSync()

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['me', target?.serverUrl],
    queryFn: () => getMe(target!),
    enabled: !!target,
    staleTime: 60_000,
  })

  if (!isLoaded) return <LoadingSpinner className="py-12" label="Loading account..." />
  if (!user) return null

  const displayName =
    user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'You'
  const email = user.primaryEmailAddress?.emailAddress ?? 'Not set'
  const memberSince = fmtDay(user.createdAt)
  const accountType = server?.role === 'admin' ? 'Server admin' : 'HearthShelf account'

  const handlePhotoClick = () => {
    setUploadErr(null)
    fileRef.current?.click()
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadErr(null)
    try {
      await user.setProfileImage({ file })
      // Push the new Clerk photo to the connected server so other users see it.
      await user.reload().catch(() => {})
      void syncClerkPhoto()
    } catch {
      setUploadErr('Photo upload failed. Try a smaller image.')
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected
      e.target.value = ''
    }
  }

  const handleSyncPhoto = async () => {
    setSyncMsg(null)
    const ok = await syncClerkPhoto()
    setSyncMsg(ok ? 'Photo synced to this server.' : 'Nothing to sync, or a custom photo is set here.')
  }

  // Permissions from the active server (update/delete/download/upload booleans)
  const perms = me?.permissions ? Object.entries(me.permissions).filter(([, v]) => v === true) : []
  const isAdmin = me?.type === 'admin' || me?.type === 'root'

  const infoRows: [string, string, string][] = [
    ['person', 'Display name', displayName],
    ['email', 'Email', email],
    ['badge', 'Account type', accountType],
    ['calendar_today', 'Member since', memberSince],
    ['dns', 'Linked servers', servers.length === 1 ? '1 server' : `${servers.length} servers`],
  ]

  return (
    <section>
      <div className="section-head">
        <Icon name="person" />
        <h2>Account</h2>
      </div>

      {/* Profile photo */}
      <div className="set-group" style={{ marginBottom: 'var(--s4)' }}>
        <div className="cfg-line">
          <Icon name="account_circle" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Profile photo</div>
            <div className="cl-d">Used across HearthShelf. Click to change.</div>
          </div>
          <button
            className="acct-avatar-btn"
            onClick={handlePhotoClick}
            disabled={uploading}
            title="Change profile photo"
          >
            {uploading ? (
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            ) : (
              <Avatar name={displayName} imageUrl={user.imageUrl} size={52} />
            )}
            <span className="acct-avatar-badge">
              <Icon name="photo_camera" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
        </div>
        {uploadErr && (
          <div className="cfg-line" style={{ color: 'var(--primary)', fontSize: 13 }}>
            <Icon name="error" style={{ color: 'var(--primary)' }} />
            {uploadErr}
          </div>
        )}
        <div className="cfg-line">
          <Icon name="sync" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Sync photo to your servers</div>
            <div className="cl-d">
              Copy your sign-in photo to this server so other listeners see it on the
              leaderboard and book pages.
            </div>
          </div>
          <button className="btn-sm btn-ghost" onClick={handleSyncPhoto} disabled={syncing || !target}>
            {syncing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Icon name="sync" />
            )}
            {syncing ? 'Syncing' : 'Sync'}
          </button>
        </div>
        {syncMsg && (
          <div className="cfg-line" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <Icon name="info" style={{ color: 'var(--text-muted)' }} />
            {syncMsg}
          </div>
        )}
        <div className="cfg-line">
          <Icon name="public" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Use Gravatar</div>
            <div className="cl-d">
              Show your Gravatar (linked to your email) when no photo is uploaded.
            </div>
          </div>
          <Toggle on={gravatarOn} onChange={(v) => setSetting('useGravatar', v)} />
        </div>
      </div>

      {/* Account info */}
      <div className="cfg-card">
        {infoRows.map(([icon, label, value]) => (
          <div className="cfg-line" key={label}>
            <Icon name={icon} style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{label}</div>
            </div>
            <span style={{ color: 'var(--text-muted)' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Server permissions (only shown when a server is linked and responding) */}
      {me && (isAdmin || perms.length > 0) && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
            <Icon name="verified_user" />
            <h2>Permissions</h2>
          </div>
          <div className="meta-chips">
            {isAdmin && (
              <span className="chip">
                <Icon name="check" /> admin
              </span>
            )}
            {perms.map(([k]) => (
              <span className="chip" key={k}>
                <Icon name="check" /> {k}
              </span>
            ))}
          </div>
        </>
      )}

      <AdvancedPanel />
    </section>
  )
}

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
      // Clipboard blocked; UA is still selectable on screen.
    }
  }

  return (
    <>
      <div
        className="cfg-line"
        style={{ marginTop: 18, cursor: 'pointer' }}
        onClick={() => set('showAdvanced', !showAdvanced)}
      >
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
            <Icon name="tag" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">Build</div>
              <div className="cl-d">
                Confirms the browser has this exact deploy, not a cached older one.
              </div>
            </div>
            <span
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12.5,
              }}
            >
              {__BUILD_COMMIT__} &middot;{' '}
              {new Date(__BUILD_TIME__).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>

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
            <button className="btn-sm btn-ghost" style={{ flex: 'none' }} onClick={copyUa}>
              <Icon name={copied ? 'check' : 'content_copy'} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
