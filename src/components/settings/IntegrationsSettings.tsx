import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { GoodreadsImportDialog } from '@/components/GoodreadsImportDialog'
import {
  connectHardcover,
  disconnectHardcover,
  finishedBooksKeys,
  getHardcoverAccount,
  triggerHardcoverSync,
} from '@/api/finishedBooks'

export function IntegrationsSettings() {
  return (
    <section>
      <div className="section-head">
        <Icon name="hub" />
        <h2>Integrations</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Connect other services and import your reading history.
      </p>
      <HardcoverSettings />
      <GoodreadsImport />
      <div className="cfg-card" style={{ marginTop: 'var(--s4)' }}>
        <div className="cfg-line">
          <Icon name="hub" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Server integrations</div>
            <div className="cl-d">
              ReadMeABook and similar integrations are set up by your server admin under Server
              &rarr; Integrations on the server itself.
            </div>
          </div>
        </div>
      </div>
      <ExternalBookLinks />
    </section>
  )
}

function ExternalBookLinks() {
  const extGoodreads = useSettingsStore((s) => s.externalLinkGoodreads)
  const extAudible = useSettingsStore((s) => s.externalLinkAudible)
  const extHardcover = useSettingsStore((s) => s.externalLinkHardcover)
  const setSetting = useSettingsStore((s) => s.set)
  return (
    <div style={{ marginTop: 'var(--s6)' }}>
      <div className="section-head">
        <Icon name="menu_book" />
        <h2>External book links</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="menu_book" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Goodreads</div>
            <div className="cl-d">Show a Goodreads search link on each book's detail page.</div>
          </div>
          <Toggle
            on={extGoodreads}
            onChange={(v) => setSetting('externalLinkGoodreads', v)}
          />
        </div>
        <div className="cfg-line">
          <Icon name="headphones" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Audible</div>
            <div className="cl-d">Show an Audible search link on each book's detail page.</div>
          </div>
          <Toggle on={extAudible} onChange={(v) => setSetting('externalLinkAudible', v)} />
        </div>
        <div className="cfg-line">
          <Icon name="auto_stories" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Hardcover</div>
            <div className="cl-d">Show a Hardcover search link on each book's detail page.</div>
          </div>
          <Toggle on={extHardcover} onChange={(v) => setSetting('externalLinkHardcover', v)} />
        </div>
      </div>
    </div>
  )
}

function HardcoverSettings() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const [token, setToken] = useState('')
  const hardcoverDocsUrl = 'https://docs.hearthshelf.com/webapp/hardcover'
  const { data } = useQuery({
    queryKey: finishedBooksKeys.hardcover(target?.serverId ?? ''),
    queryFn: () => getHardcoverAccount(target!),
    enabled: Boolean(target),
    staleTime: 30_000,
  })
  const connect = useMutation({
    mutationFn: () => connectHardcover(target!, token.trim()),
    onSuccess: (account) => {
      qc.setQueryData(finishedBooksKeys.hardcover(target?.serverId ?? ''), account)
      setToken('')
    },
  })
  const disconnect = useMutation({
    mutationFn: () => disconnectHardcover(target!),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: finishedBooksKeys.hardcover(target?.serverId ?? '') }),
  })
  const sync = useMutation({
    mutationFn: () => triggerHardcoverSync(target!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: finishedBooksKeys.hardcover(target?.serverId ?? '') })
      qc.invalidateQueries({ queryKey: finishedBooksKeys.list(target?.serverId ?? '') })
    },
  })
  const connected = data?.connected === true
  return (
    <div className="cfg-card">
      <div className="cfg-line">
        <Icon
          name={connected ? 'check_circle' : 'auto_stories'}
          fill={connected}
          style={{ color: connected ? '#5a9c52' : 'var(--text-muted)' }}
        />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Hardcover</div>
          <div className="cl-d">
            {connected
              ? `Connected as ${data?.username ?? 'your Hardcover account'}.`
              : 'Sync the books you finish here to your Hardcover reading history.'}
            {connected && data?.lastSyncAt
              ? ` Last synced ${new Date(data.lastSyncAt).toLocaleString()}.`
              : ''}
          </div>
        </div>
        <span className="badge-pill">{connected ? 'Connected' : 'Not connected'}</span>
      </div>
      {!connected && (
        <>
          <div className="field full" style={{ marginTop: 'var(--s3)' }}>
            <label>Personal access token</label>
            <input
              className="fld"
              type="password"
              autoComplete="off"
              placeholder="Paste your Hardcover API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <details style={{ marginTop: 'var(--s2)' }}>
            <summary
              style={{
                color: 'var(--primary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Need Help?
            </summary>
            <div className="cl-d" style={{ marginTop: 'var(--s2)' }}>
              Create a personal access token in Hardcover, paste it here, then HearthShelf will sync
              books you mark finished to your Hardcover reading history. Your token is stored on
              your connected HearthShelf server and is not shown again after it is saved.{' '}
              <a href={hardcoverDocsUrl} target="_blank" rel="noreferrer noopener">
                Read the Hardcover integration guide.
              </a>
            </div>
          </details>
        </>
      )}
      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
        {!connected ? (
          <button
            className="btn-sm btn-green"
            disabled={!target || !token.trim() || connect.isPending}
            onClick={() => connect.mutate()}
          >
            <Icon name="save" /> Connect
          </button>
        ) : (
          <>
            <button
              className="btn-sm btn-green"
              disabled={!target || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <Icon name="sync" /> Sync now
            </button>
            <button
              className="btn-sm"
              disabled={!target || disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function GoodreadsImport() {
  const [open, setOpen] = useState(false)
  return (
    <div className="cfg-card" style={{ marginTop: 'var(--s4)' }}>
      <div className="cfg-line">
        <Icon name="upload_file" style={{ color: 'var(--text-muted)' }} />
        <div className="cl-meta" style={{ flex: 1 }}>
          <div className="cl-t">Import from Goodreads</div>
          <div className="cl-d">
            Upload your Goodreads export CSV to bring in your reading history.
          </div>
        </div>
        <button className="btn-sm" onClick={() => setOpen(true)}>
          <Icon name="upload_file" /> Import
        </button>
      </div>
      {open && <GoodreadsImportDialog onClose={() => setOpen(false)} />}
    </div>
  )
}
