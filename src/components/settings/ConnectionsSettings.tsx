import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getCommunityConfig, socialKeys } from '@/api/absSocial'
import {
  connectHardcover,
  disconnectHardcover,
  finishedBooksKeys,
  getHardcoverAccount,
  triggerHardcoverSync,
} from '@/api/finishedBooks'

export function ConnectionsSettings() {
  return (
    <section>
      <div className="section-head">
        <Icon name="hub" />
        <h2>Connections</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Where your linked accounts, imports, and server integrations live.
      </p>
      <HardcoverSettings />
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
      <SearchSources />
      <CommunitySharing />
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
          <Toggle on={extGoodreads} onChange={(v) => setSetting('externalLinkGoodreads', v)} />
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

function SearchSources() {
  const searchExternalSources = useSettingsStore((s) => s.searchExternalSources)
  const setSetting = useSettingsStore((s) => s.set)
  return (
    <div style={{ marginTop: 'var(--s6)' }}>
      <div className="section-head">
        <Icon name="search" />
        <h2>Search</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="travel_explore" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Search outside your library</div>
            <div className="cl-d">
              Also find audiobooks you don't own yet. Search shows them in a "Not in your library"
              section so you can request them.
            </div>
          </div>
          <Toggle
            on={searchExternalSources}
            onChange={(v) => setSetting('searchExternalSources', v)}
          />
        </div>
      </div>
    </div>
  )
}

function HardcoverSettings() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const [token, setToken] = useState('')
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
        <button className="btn-sm" onClick={() => navigate('/settings/import/goodreads')}>
          <Icon name="upload_file" /> Import from Goodreads
        </button>
      </div>
    </div>
  )
}

function CommunitySharing() {
  const { target } = useActiveServer()
  const shareReadBooks = useSettingsStore((s) => s.shareReadBooks)
  const shareCurrentlyListening = useSettingsStore((s) => s.shareCurrentlyListening)
  const setSetting = useSettingsStore((s) => s.set)
  const { data: community } = useQuery({
    queryKey: socialKeys.communityConfig(target?.serverId ?? ''),
    queryFn: () => getCommunityConfig(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const defaultShare = community?.defaultShare ?? true
  const defaultShareListening = community?.defaultShareListening ?? false
  const readEffective = shareReadBooks ?? defaultShare
  const listeningEffective = shareCurrentlyListening ?? defaultShareListening
  return (
    <div style={{ marginTop: 'var(--s6)' }}>
      <div className="section-head">
        <Icon name="groups" />
        <h2>Community</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="leaderboard" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Share my reading list</div>
            <div className="cl-d">
              {shareReadBooks === null
                ? `Following the server default (currently ${defaultShare ? 'shared' : 'hidden'}) until you choose.`
                : 'Appear on server reading lists with your name. Turn this off to stay hidden.'}
            </div>
          </div>
          <Toggle on={readEffective} onChange={(v) => setSetting('shareReadBooks', v)} />
        </div>
        <div className="cfg-line">
          <Icon name="podcasts" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Share when I'm listening</div>
            <div className="cl-d">
              {shareCurrentlyListening === null
                ? `Following the server default (currently ${defaultShareListening ? 'shared' : 'hidden'}) until you choose.`
                : "Let other listeners see you're currently listening. Turn this off to stay hidden."}
            </div>
          </div>
          <Toggle
            on={listeningEffective}
            onChange={(v) => setSetting('shareCurrentlyListening', v)}
          />
        </div>
      </div>
    </div>
  )
}
