import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getServerSettings,
  updateServerSettings,
  adminContentKeys,
  type ABSServerSettings,
} from '@/api/absAdmin'
import {
  setServerName,
  getServerVersions,
  hostedKeys,
  recoverConnectionSecret,
} from '@/api/absHosted'
import { resetServerSecret } from '@/api/controlPlane'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'
import { useToast } from '@/hooks/useToast'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// General server settings. The server name (the display name this server is
// known by) is editable here via the HearthShelf backend; scanner + display
// settings are ABS-native and editable too.
export function ConfigServerInfo() {
  const { target } = useActiveServer()

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Settings</h1>
      </div>

      <div className="section-head">
        <Icon name="badge" />
        <h2>Server</h2>
      </div>
      <ServerNameSetting />

      <ScannerDisplaySettings />

      <AdvancedServerInfo />
    </>
  )
}

// Version details behind a toggle: the audiobookshelf server version and the
// HearthShelf backend version this box is running. Both reads are public.
function AdvancedServerInfo() {
  const { target } = useActiveServer()
  const { latest, updateAvailable } = useUpdateStatus()
  const [open, setOpen] = useState(false)

  const { data } = useQuery({
    queryKey: hostedKeys.versions(target?.serverId ?? ''),
    queryFn: () => getServerVersions(target!),
    enabled: Boolean(target) && open,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <>
      <div
        className="cfg-line"
        style={{ marginTop: 'var(--s6)', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="code" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Advanced</div>
          <div className="cl-d">Version details for support and troubleshooting.</div>
        </div>
        <Icon name={open ? 'expand_less' : 'expand_more'} style={{ color: 'var(--text-muted)' }} />
      </div>

      {open && (
        <div className="cfg-card" style={{ marginTop: 10 }}>
          <div className="cfg-line">
            <Icon name="dns" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">audiobookshelf</div>
              <div className="cl-d">The underlying media server version.</div>
            </div>
            <span style={{ color: 'var(--text-muted)' }}>
              {data?.absVersion ? `v${data.absVersion}` : '-'}
            </span>
          </div>
          <div className="cfg-line">
            <Icon name="local_fire_department" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">HearthShelf</div>
              <div className="cl-d">The HearthShelf backend running on this box.</div>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {updateAvailable && latest && (
                <a
                  className="badge-pill"
                  href={latest.notes_url ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ color: '#e0b968', textDecoration: 'none' }}
                >
                  v{latest.version} available
                </a>
              )}
              <span style={{ color: 'var(--text-muted)' }}>
                {data?.hsVersion ? `v${data.hsVersion}` : 'Not detected'}
              </span>
            </span>
          </div>
          <ResetConnectionSecret />
        </div>
      )}
    </>
  )
}

// Recovery hatch: rotate the connection secret shared between this box and
// HearthShelf, in place. For a box that lost or desynced its stored secret (data
// restored from an old backup, an interrupted re-pair). Mints a new secret on the
// control plane and hands it to the box in one step; links, invites, and certs
// survive (unlike disconnect + re-pair). Owner-admin only, enforced server-side.
function ResetConnectionSecret() {
  const { target } = useActiveServer()
  const { toast, show } = useToast()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const run = async () => {
    if (!target) return
    setBusy(true)
    try {
      const { server_secret } = await resetServerSecret(target.serverId)
      await recoverConnectionSecret(target, server_secret)
      show('Connection secret reset and re-synced')
      setConfirming(false)
    } catch {
      show('Could not reset the connection secret')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cfg-line" style={{ marginTop: 10 }}>
      <Icon name="key" style={{ color: 'var(--text-muted)' }} />
      <div className="cl-meta" style={{ flex: 1 }}>
        <div className="cl-t">Reset connection secret</div>
        <div className="cl-d">
          Re-sync this server with HearthShelf if the connection has drifted. Keeps your users,
          invites, and certificate.
        </div>
      </div>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
          <button className="btn-sm btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button className="btn-sm btn-danger" disabled={busy} onClick={() => void run()}>
            {busy ? 'Resetting...' : 'Confirm reset'}
          </button>
        </div>
      ) : (
        <button className="btn-sm btn-ghost" style={{ flex: 'none' }} onClick={() => setConfirming(true)}>
          <Icon name="key" /> Reset
        </button>
      )}
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}

function ServerNameSetting() {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target, server } = useActiveServer()
  const [name, setName] = useState(server?.name ?? '')
  const [saving, setSaving] = useState(false)

  const dirty = name.trim() !== (server?.name ?? '') && name.trim().length >= 2

  const save = async () => {
    if (!target || !dirty) return
    setSaving(true)
    try {
      await setServerName(target, name.trim())
      // The switcher reads the server list from the control plane; refresh it so
      // the new name shows everywhere.
      qc.invalidateQueries({ queryKey: ['servers'] })
      show('Server name saved')
    } catch {
      show('Could not save the server name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cfg-card">
      <div className="cfg-line" style={{ gap: 12 }}>
        <Icon name="dns" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 'none', width: 150 }}>
          <div className="cl-t">Server name</div>
          <div className="cl-d">How this server appears in HearthShelf.</div>
        </div>
        <input
          className="fld"
          style={{ flex: 1 }}
          placeholder="My HearthShelf"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn-sm btn-green"
          style={{ flex: 'none' }}
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          <Icon name="save" /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="cfg-line">
        <Icon name="lan" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Connection</div>
          <div className="cl-d">This server is connected to HearthShelf.</div>
        </div>
        <span className="badge-pill" style={{ color: '#7fbd6f' }}>
          Connected
        </span>
      </div>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}

const SCANNER_TOGGLES: {
  key:
    | 'scannerFindCovers'
    | 'scannerParseSubtitle'
    | 'scannerPreferMatchedMetadata'
    | 'scannerDisableWatcher'
    | 'storeCoverWithItem'
  label: string
  desc: string
}[] = [
  {
    key: 'scannerFindCovers',
    label: 'Find covers',
    desc: 'Search for a cover online when an item has none.',
  },
  {
    key: 'scannerParseSubtitle',
    label: 'Parse subtitles',
    desc: 'Pull a subtitle from the folder name after a dash.',
  },
  {
    key: 'scannerPreferMatchedMetadata',
    label: 'Prefer matched metadata',
    desc: 'Let matched provider data override existing details.',
  },
  {
    key: 'scannerDisableWatcher',
    label: 'Disable folder watcher',
    desc: 'Stop scanning automatically when files change on disk.',
  },
  {
    key: 'storeCoverWithItem',
    label: 'Store covers with item',
    desc: 'Save the cover alongside the audio files instead of in metadata.',
  },
]

function ScannerDisplaySettings() {
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.serverSettings(target?.serverId ?? ''),
    queryFn: () => getServerSettings(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  if (!data) return null
  return <ScannerDisplayForm key={JSON.stringify(data)} settings={data} />
}

function ScannerDisplayForm({ settings }: { settings: ABSServerSettings }) {
  const qc = useQueryClient()
  const { target } = useActiveServer()

  const [toggles, setToggles] = useState<Record<string, boolean>>({
    scannerFindCovers: !!settings.scannerFindCovers,
    scannerParseSubtitle: !!settings.scannerParseSubtitle,
    scannerPreferMatchedMetadata: !!settings.scannerPreferMatchedMetadata,
    scannerDisableWatcher: !!settings.scannerDisableWatcher,
    storeCoverWithItem: !!settings.storeCoverWithItem,
  })
  const [dateFormat, setDateFormat] = useState(settings.dateFormat ?? '')
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    if (!target) return
    setSaving(true)
    try {
      await updateServerSettings(target, {
        ...toggles,
        dateFormat: dateFormat || undefined,
        timeFormat: timeFormat || undefined,
      })
      qc.invalidateQueries({ queryKey: adminContentKeys.serverSettings(target.serverId) })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="manage_search" />
        <h2>Scanner</h2>
      </div>
      <div className="cfg-card">
        {SCANNER_TOGGLES.map((t) => (
          <div className="cfg-line" key={t.key}>
            <Icon name="tune" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{t.label}</div>
              <div className="cl-d">{t.desc}</div>
            </div>
            <button
              className={toggles[t.key] ? 'toggle on' : 'toggle'}
              aria-pressed={!!toggles[t.key]}
              onClick={() => setToggles((cur) => ({ ...cur, [t.key]: !cur[t.key] }))}
            >
              <i />
            </button>
          </div>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="calendar_today" />
        <h2>Display</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line" style={{ gap: 12 }}>
          <div className="cl-meta" style={{ width: 150, flex: 'none' }}>
            <div className="cl-t">Date format</div>
          </div>
          <input
            className="fld"
            placeholder="MM/dd/yyyy"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value)}
          />
        </div>
        <div className="cfg-line" style={{ gap: 12 }}>
          <div className="cl-meta" style={{ width: 150, flex: 'none' }}>
            <div className="cl-t">Time format</div>
          </div>
          <input
            className="fld"
            placeholder="HH:mm"
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value)}
          />
        </div>
      </div>

      <div
        className="cfg-line"
        style={{ gap: 8, justifyContent: 'flex-end', marginTop: 'var(--s5)' }}
      >
        <button className="btn-sm btn-green" disabled={saving} onClick={() => void save()}>
          {saved ? <Icon name="check" /> : <Icon name="save" />} {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </>
  )
}
