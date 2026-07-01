import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCustomProviders, adminContentKeys } from '@/api/absAdmin'
import {
  getIntegrationsConfig,
  saveIntegrationsConfig,
  integrationsKeys,
  type IntegrationsConfig,
  type IntegrationsConfigPatch,
} from '@/api/absIntegrations'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useToast } from '@/hooks/useToast'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

const REGION_LABELS: Record<string, string> = {
  us: 'United States',
  ca: 'Canada',
  uk: 'United Kingdom',
  au: 'Australia',
  in: 'India',
  de: 'Germany',
  es: 'Spain',
  fr: 'France',
}

// Inline marker next to a field pinned by an environment variable (read-only).
function EnvLockTag() {
  return (
    <span
      title="This value is set by an environment variable and overrides the database. Remove the env var to edit it here."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11.5,
        fontWeight: 600,
        color: 'var(--text-muted)',
        marginLeft: 8,
      }}
    >
      <Icon name="lock" style={{ fontSize: 14 }} /> Set by environment
    </span>
  )
}

function StatusPill({ on }: { on: boolean }) {
  return (
    <span
      className="badge-pill"
      style={{
        background: on ? 'color-mix(in oklab, #5a9c52 20%, transparent)' : 'var(--fill)',
        color: on ? '#7fbd6f' : 'var(--text-muted)',
      }}
    >
      {on ? 'Connected' : 'Off'}
    </span>
  )
}

// Integrations. The HearthShelf-managed integrations (ReadMeABook, Audplexus,
// Audible catalog region) are editable here via the server's HearthShelf
// backend. ABS's own custom metadata providers are shown read-only below.
export function ConfigIntegrations() {
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: integrationsKeys.config(target?.serverId ?? ''),
    queryFn: () => getIntegrationsConfig(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Integrations</h1>
        <p className="page-sub">
          External services HearthShelf talks to, and the metadata providers AudiobookShelf uses for
          matching and search.
        </p>
      </div>

      {!target || isLoading || !data ? (
        <LoadingSpinner className="py-12" label="Loading..." />
      ) : (
        <IntegrationsForm key={JSON.stringify(data.env)} config={data} />
      )}

      <CustomProviders />
    </>
  )
}

function IntegrationsForm({ config }: { config: IntegrationsConfig }) {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()

  // Editable text fields; secrets are separate write-only inputs (blank = keep).
  const [rmabUrl, setRmabUrl] = useState(config.rmabUrl ?? '')
  const [rmabToken, setRmabToken] = useState('')
  const [audplexusUrl, setAudplexusUrl] = useState(config.audplexusUrl ?? '')
  const [audplexusKey, setAudplexusKey] = useState('')
  const [region, setRegion] = useState(config.audibleRegion)

  // Keep the live config around so the status pills reflect the latest save.
  const latest = useRef(config)
  useEffect(() => {
    latest.current = config
  }, [config])

  const save = useMutation({
    mutationFn: (patch: IntegrationsConfigPatch) => saveIntegrationsConfig(target!, patch),
    onSuccess: (next) => {
      qc.setQueryData(integrationsKeys.config(target!.serverId), next)
      // The Requests nav gate keys off rmabConfigured; refresh anything watching.
      qc.invalidateQueries({ queryKey: ['rmab'] })
      setRmabToken('')
      setAudplexusKey('')
      show('Integrations saved')
    },
    onError: () => show('Could not save - admin permission required'),
  })

  const env = config.env

  const saveRmab = () => {
    const patch: IntegrationsConfigPatch = {}
    if (!env.rmabUrl) patch.rmabUrl = rmabUrl.trim() || null
    if (!env.rmabLoginToken && rmabToken.trim()) patch.rmabLoginToken = rmabToken.trim()
    save.mutate(patch)
  }
  const saveAudplexus = () => {
    const patch: IntegrationsConfigPatch = {}
    if (!env.audplexusUrl) patch.audplexusUrl = audplexusUrl.trim() || null
    if (!env.audplexusKey && audplexusKey.trim()) patch.audplexusKey = audplexusKey.trim()
    save.mutate(patch)
  }
  const saveRegion = (next: string) => {
    setRegion(next)
    if (!env.audibleRegion) save.mutate({ audibleRegion: next })
  }

  return (
    <>
      {/* ReadMeABook */}
      <div className="section-head">
        <Icon name="auto_stories" />
        <h2>ReadMeABook</h2>
        <span style={{ marginLeft: 'auto' }}>
          <StatusPill on={config.rmabConfigured} />
        </span>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>Server URL{env.rmabUrl && <EnvLockTag />}</label>
          <input
            className="fld"
            placeholder="https://audiobooks.example.com"
            value={env.rmabUrl ? (config.rmabUrl ?? '') : rmabUrl}
            disabled={env.rmabUrl}
            onChange={(e) => setRmabUrl(e.target.value)}
          />
        </div>
        <div className="field full">
          <label>Login token{env.rmabLoginToken && <EnvLockTag />}</label>
          <input
            className="fld"
            type="password"
            autoComplete="off"
            placeholder={
              env.rmabLoginToken
                ? '•••••••• (from environment)'
                : config.rmabHasToken
                  ? '•••••••• (leave blank to keep)'
                  : 'Paste login token'
            }
            value={rmabToken}
            disabled={env.rmabLoginToken}
            onChange={(e) => setRmabToken(e.target.value)}
          />
        </div>
        {!(env.rmabUrl && env.rmabLoginToken) && (
          <button className="btn-sm btn-green" disabled={save.isPending} onClick={saveRmab}>
            <Icon name="save" /> Save
          </button>
        )}
      </div>

      {/* Audplexus */}
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="graphic_eq" />
        <h2>Audplexus</h2>
        <span style={{ marginLeft: 'auto' }}>
          <StatusPill on={config.audplexusConfigured} />
        </span>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>Server URL{env.audplexusUrl && <EnvLockTag />}</label>
          <input
            className="fld"
            placeholder="https://audplexus.example.com"
            value={env.audplexusUrl ? (config.audplexusUrl ?? '') : audplexusUrl}
            disabled={env.audplexusUrl}
            onChange={(e) => setAudplexusUrl(e.target.value)}
          />
        </div>
        <div className="field full">
          <label>API key{env.audplexusKey && <EnvLockTag />}</label>
          <input
            className="fld"
            type="password"
            autoComplete="off"
            placeholder={
              env.audplexusKey
                ? '•••••••• (from environment)'
                : config.audplexusHasKey
                  ? '•••••••• (leave blank to keep)'
                  : 'Paste API key'
            }
            value={audplexusKey}
            disabled={env.audplexusKey}
            onChange={(e) => setAudplexusKey(e.target.value)}
          />
        </div>
        {!(env.audplexusUrl && env.audplexusKey) && (
          <button className="btn-sm btn-green" disabled={save.isPending} onClick={saveAudplexus}>
            <Icon name="save" /> Save
          </button>
        )}
      </div>

      {/* Audible catalog region */}
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="public" />
        <h2>Audible catalog region</h2>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>Region{env.audibleRegion && <EnvLockTag />}</label>
          <select
            className="fld"
            value={env.audibleRegion ? config.audibleRegion : region}
            disabled={env.audibleRegion || save.isPending}
            onChange={(e) => saveRegion(e.target.value)}
          >
            {config.validRegions.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r] ?? r.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </>
  )
}

// ABS's own custom metadata providers - read-only (managed in ABS itself).
function CustomProviders() {
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.customProviders(target?.serverId ?? ''),
    queryFn: () => getCustomProviders(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })
  const providers = data?.providers ?? []

  return (
    <>
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="travel_explore" />
        <h2>Custom metadata providers</h2>
      </div>
      {!data ? (
        <LoadingSpinner className="py-8" label="Loading..." />
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <Icon name="extension_off" />
          <h3>No custom providers</h3>
          <p>Built-in providers (Audible, Google, iTunes, Open Library) are always available.</p>
        </div>
      ) : (
        <div className="cfg-card">
          {providers.map((p) => (
            <div className="cfg-line" key={p.id}>
              <Icon name="travel_explore" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta">
                <div className="cl-t">{p.name}</div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{p.url}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
