import { useEffect, useRef, useState } from 'react'
import { useUser } from '@/auth/useAuth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Loader2 } from 'lucide-react'
import { Toggle } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'
import { useVisualViewportSize } from '@/hooks/useVisualViewportSize'
import { useSettingsStore } from '@/store/settingsStore'
import { useProviderAvatarSync } from '@/hooks/useProviderAvatarSync'
import { authClient } from '@/auth/client'
import { notify } from '@/lib/notify'
import {
  deleteServerAvatar,
  probeAvatarSource,
  uploadAvatar,
  type AvatarProbeResult,
  type AvatarSyncFailReason,
  type AvatarSyncResult,
} from '@/api/avatars'

function syncFailMessage(reason: AvatarSyncFailReason): string {
  switch (reason) {
    case 'no_photo':
      return 'No sign-in photo to sync yet.'
    case 'fetch_failed':
      return "Couldn't download your sign-in photo. Try again in a moment."
    case 'encode_failed':
      return "Couldn't process your sign-in photo. Try a different photo in your account settings."
    case 'no_token':
      return 'Not signed in to this server. Reconnect and try again.'
    case 'no_abs_user':
      return "Couldn't confirm your account on this server. Try again in a moment."
    case 'request_failed':
      return "Couldn't reach this server. Try again in a moment."
    case 'server_skipped':
      return 'A custom photo is set on this server. Remove it to use your sign-in photo instead.'
    default:
      return 'Nothing to sync.'
  }
}

function syncResultLabel(result: AvatarSyncResult | null): string {
  if (!result) return 'not run yet'
  if (result.ok) return 'synced OK'
  return syncFailMessage(result.reason)
}

function probeLabel(probe: AvatarProbeResult | 'loading' | null): string {
  if (probe === null) return 'expand to check'
  if (probe === 'loading') return 'checking...'
  switch (probe.state) {
    case 'stored':
      return 'a stored photo (upload or synced sign-in copy)'
    case 'gravatar_redirect':
      return 'your Gravatar'
    case 'none':
      return 'nothing - initials fallback'
    case 'unknown':
      return `couldn't tell (${probe.detail})`
  }
}

export function AccountSettings() {
  const { user, isLoaded } = useUser()
  const { target } = useActiveServer()
  const useGravatar = useSettingsStore((s) => s.useGravatar)
  const useSharedSettings = useSettingsStore((s) => s.useSharedSettings)
  const setSetting = useSettingsStore((s) => s.set)
  // Cache-busts our own avatar <img> whenever the Gravatar preference changes -
  // the server's resolved photo can flip (Gravatar <-> sign-in photo/initials) without
  // the URL changing, and the GET route caches for 5 minutes.
  const avatarVersion = useSettingsStore((s) => s.meta.useGravatar)
  // null = never chose, so the default (on) applies; only an explicit false is off.
  const gravatarOn = useGravatar !== false
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)

  const queryClient = useQueryClient()

  const { data: me } = useQuery({
    queryKey: ['me', target?.serverUrl],
    queryFn: () => getMe(target!),
    enabled: !!target,
    staleTime: 60_000,
  })

  useEffect(() => {
    setDisplayName(user?.fullName || '')
  }, [user?.fullName])

  if (!isLoaded) return <LoadingSpinner className="py-12" label="Loading account..." />
  if (!user) return null

  const currentDisplayName =
    user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'You'
  const email = user.primaryEmailAddress?.emailAddress ?? 'Not set'

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
      // Straight to the connected server's own store, as a real upload - it is
      // where other users are served from, and an upload outranks any photo
      // synced from whoever signed you in.
      if (!target || !me?.id) {
        setUploadErr('Connect to a server before changing your photo.')
        return
      }
      const result = await uploadAvatar(target, me.id, file)
      if (!result.ok) {
        setUploadErr('Photo upload failed. Try a smaller image.')
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['me', target.serverUrl] })
    } catch {
      setUploadErr('Photo upload failed. Try a smaller image.')
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected
      e.target.value = ''
    }
  }

  const saveDisplayName = async () => {
    const next = displayName.trim()
    if (!next || next === user.fullName) return
    setSavingName(true)
    try {
      const res = await authClient.updateUser({ name: next })
      if (res?.error) {
        notify.error(res.error.message || 'That display name is not available')
        return
      }
      notify.success('Display name updated')
    } finally {
      setSavingName(false)
    }
  }

  return (
    <section>
      <div className="section-head">
        <Icon name="person" />
        <h2>Account</h2>
      </div>

      {/* Profile photo */}
      <div className="cfg-card">
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
              <Avatar
                name={currentDisplayName}
                target={target}
                userId={me?.id}
                version={avatarVersion}
                size={52}
              />
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
        <div className="cfg-line account-name-row">
          <Icon name="person" style={{ color: 'var(--text-muted)' }} />
          <label className="cl-meta" htmlFor="account-display-name">
            <span className="cl-t">Display name</span>
            <span className="cl-d">The name other HearthShelf listeners see.</span>
          </label>
          <div className="account-inline-field">
            <input
              id="account-display-name"
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
            <button
              className="btn-sm btn-ghost"
              onClick={() => void saveDisplayName()}
              disabled={savingName || !displayName.trim() || displayName.trim() === user.fullName}
            >
              {savingName ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>
        <div className="cfg-line">
          <Icon name="email" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta">
            <div className="cl-t">Email</div>
          </div>
          <span className="account-row-value">{email}</span>
        </div>
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

      {/* Device sync */}
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="devices" />
        <h2>Device</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="sync" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Use shared settings</div>
            <div className="cl-d">
              Keep your HearthShelf settings the same on all of your devices.
            </div>
          </div>
          <Toggle on={useSharedSettings} onChange={(v) => setSetting('useSharedSettings', v)} />
        </div>
      </div>
    </section>
  )
}

export function AccountAdvancedSettings() {
  const { user } = useUser()
  const { target } = useActiveServer()
  const showAdvanced = useSettingsStore((s) => s.showAdvanced)
  const set = useSettingsStore((s) => s.set)
  const avatarVersion = useSettingsStore((s) => s.meta.useGravatar)
  const { sync: syncProviderPhoto, syncing, lastResult } = useProviderAvatarSync()
  const [copied, setCopied] = useState(false)
  const [probe, setProbe] = useState<AvatarProbeResult | 'loading' | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncBlocked, setSyncBlocked] = useState(false)
  const [removing, setRemoving] = useState(false)
  const { data: me } = useQuery({
    queryKey: ['me', target?.serverUrl],
    queryFn: () => getMe(target!),
    enabled: !!target,
    staleTime: 60_000,
  })
  const absUserId = me?.id
  const hasProviderPhoto = !!user?.imageUrl
  const perms = me?.permissions ? Object.entries(me.permissions).filter(([, value]) => value) : []
  const isAdmin = me?.type === 'admin' || me?.type === 'root'
  // A stable stand-in for `lastResult`'s identity - see the effect's dep note.
  const lastResultKey = lastResult ? (lastResult.ok ? 'ok' : lastResult.reason) : 'none'

  // Probe the live GET route only while the panel is open, so it's not a
  // background request on every Account page visit. Re-probes whenever the
  // Gravatar preference or a sync attempt could have changed the answer, so
  // the panel doesn't go stale while left open.
  useEffect(() => {
    if (!showAdvanced || !target || !absUserId) return
    let cancelled = false
    setProbe('loading')
    void probeAvatarSource(target, absUserId).then((r) => {
      if (!cancelled) setProbe(r)
    })
    return () => {
      cancelled = true
    }
    // `lastResult` is deliberately reduced to a primitive: it is a fresh object
    // on every sync, so depending on it directly re-fired this probe forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdvanced, target, absUserId, avatarVersion, lastResultKey])

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const detected = isCarBrowser()
  // Live screen readout. Car dashboards vary wildly and don't identify their
  // model, so the only way to size a layout for one is to read the numbers off
  // the car itself - which is what this panel is for.
  const vv = useVisualViewportSize()
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const screenSize =
    typeof window === 'undefined' ? '?' : `${window.screen.width} x ${window.screen.height}`
  const windowSize =
    typeof window === 'undefined' ? '?' : `${window.innerWidth} x ${window.innerHeight}`

  const copyUa = async () => {
    try {
      await navigator.clipboard.writeText(ua)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; UA is still selectable on screen.
    }
  }

  const handleSyncPhoto = async () => {
    setSyncMsg(null)
    setSyncBlocked(false)
    const result = await syncProviderPhoto()
    setSyncMsg(result.ok ? 'Photo synced.' : syncFailMessage(result.reason))
    setSyncBlocked(!result.ok && result.reason === 'server_skipped')
  }

  const handleRemoveCustomPhoto = async () => {
    if (!target || !absUserId) return
    setRemoving(true)
    try {
      const ok = await deleteServerAvatar(target, absUserId)
      if (!ok) {
        setSyncMsg("Couldn't remove the custom photo. Try again in a moment.")
        return
      }
      setSyncBlocked(false)
      const result = await syncProviderPhoto()
      setSyncMsg(result.ok ? 'Photo synced.' : syncFailMessage(result.reason))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <button
        className="account-advanced-toggle"
        onClick={() => set('showAdvanced', !showAdvanced)}
        aria-expanded={showAdvanced}
      >
        <Icon name="code" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Advanced</div>
          <div className="cl-d">Server access and troubleshooting details.</div>
        </div>
        <Icon
          name={showAdvanced ? 'expand_less' : 'expand_more'}
          style={{ color: 'var(--text-muted)' }}
        />
      </button>

      {showAdvanced && (
        <div className="cfg-card account-advanced-card">
          <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
            <Icon name="sync" style={{ color: 'var(--text-muted)', marginTop: 2 }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">Photo sync</div>
              <div className="cl-d">
                Sign-in photo: {hasProviderPhoto ? 'present' : 'none set'}
                <br />
                Last sync attempt: {syncResultLabel(lastResult)}
                <br />
                Server currently serving: {probeLabel(probe)}
              </div>
            </div>
            <button
              className="btn-sm btn-ghost"
              onClick={() => void handleSyncPhoto()}
              disabled={syncing || !target}
            >
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <Icon name="sync" />}
              {syncing ? 'Syncing' : 'Sync'}
            </button>
          </div>

          {syncMsg && (
            <div className="cfg-line account-advanced-message">
              <Icon name="info" />
              <span>{syncMsg}</span>
              {syncBlocked && (
                <button
                  className="btn-sm btn-ghost"
                  onClick={() => void handleRemoveCustomPhoto()}
                  disabled={removing}
                >
                  {removing ? 'Removing' : 'Remove custom photo'}
                </button>
              )}
            </div>
          )}

          {me && (isAdmin || perms.length > 0) && (
            <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
              <Icon name="verified_user" style={{ color: 'var(--text-muted)', marginTop: 2 }} />
              <div className="cl-meta">
                <div className="cl-t">Server permissions</div>
                <div className="cl-d account-permission-list">
                  {[isAdmin ? 'admin' : null, ...perms.map(([key]) => key)]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              </div>
            </div>
          )}

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
                fontSize: 13,
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
            <Icon name="aspect_ratio" style={{ color: 'var(--text-muted)', marginTop: 2 }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">Screen size</div>
              <div className="cl-d">
                Browser window: {windowSize}
                <br />
                Visible area: {vv.width} x {vv.height}
                <br />
                Screen: {screenSize}
                <br />
                Pixel ratio: {dpr}x
              </div>
            </div>
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
