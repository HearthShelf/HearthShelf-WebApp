import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getCommunityConfig,
  setCommunityConfig,
  socialKeys,
  type CommunityConfig,
} from '@/api/absSocial'
import {
  getTelemetryConfig,
  setTelemetryEnabled,
  hostedKeys,
  type TelemetryConfig,
} from '@/api/absHosted'

// Community (social) admin settings. The default-sharing settings govern
// whether a listener appears on the leaderboard / listening-now before they
// choose for themselves. Defaults only govern users who never set their own
// preference - changing one is retroactive for them but never overrides
// someone who chose for themselves. notesEnabled/clubsEnabled are hard
// kill-switches for the whole server.
export function ConfigCommunity() {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: socialKeys.communityConfig(target?.serverId ?? ''),
    queryFn: () => getCommunityConfig(target!),
    enabled: Boolean(target),
    staleTime: 30 * 1000,
  })

  const save = useMutation({
    mutationFn: (patch: Partial<CommunityConfig>) => setCommunityConfig(target!, patch),
    onSuccess: (next: CommunityConfig) => {
      qc.setQueryData(socialKeys.communityConfig(target!.serverId), next)
      show('Community settings saved')
    },
    onError: () => show('Could not save - admin permission required'),
  })

  if (!target || isLoading || !data) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Community</h1>
        </div>
        <LoadingSpinner className="py-12" label="Loading..." />
      </>
    )
  }

  const sharing = data.defaultShare
  const sharingListening = data.defaultShareListening

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Community</h1>
        <p className="page-sub">
          Shared, cross-user features - the server leaderboard, notes, and Book Club - and what
          listeners can see of each other.
        </p>
      </div>

      <div className="section-head">
        <Icon name="groups" />
        <h2>Default sharing</h2>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>New and existing listeners appear on the leaderboard</label>
          <select
            className="fld"
            disabled={!data.canEdit || save.isPending}
            value={sharing ? 'on' : 'off'}
            onChange={(e) => save.mutate({ defaultShare: e.target.value === 'on' })}
          >
            <option value="on">On - opt-out (shared by default)</option>
            <option value="off">Off - opt-in (hidden by default)</option>
          </select>
        </div>
        <div className="banner info" style={{ marginTop: 'var(--s4)' }}>
          <Icon name="info" />
          {sharing
            ? 'Listeners are shown on the leaderboard unless they turn sharing off for themselves. Anyone who already chose to hide stays hidden.'
            : 'Listeners are hidden from the leaderboard unless they turn sharing on for themselves. Anyone who already chose to share stays shown.'}
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="podcasts" />
        <h2>Listening-now presence</h2>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>New and existing listeners show as "listening recently"</label>
          <select
            className="fld"
            disabled={!data.canEdit || save.isPending}
            value={sharingListening ? 'on' : 'off'}
            onChange={(e) => save.mutate({ defaultShareListening: e.target.value === 'on' })}
          >
            <option value="on">On - opt-out (shared by default)</option>
            <option value="off">Off - opt-in (hidden by default)</option>
          </select>
        </div>
        <div className="banner info" style={{ marginTop: 'var(--s4)' }}>
          <Icon name="info" />
          Real-time presence is more sensitive than a historical reading list, so this ships off
          by default. {sharingListening ? 'Currently on' : 'Currently off'} for anyone who hasn't
          chosen for themselves.
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="edit_note" />
        <h2>Feature kill-switches</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="sticky_note_2" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Public notes</div>
            <div className="cl-d">Per-book notes visible to every listener on this server.</div>
          </div>
          <select
            className="fld"
            style={{ width: 'auto' }}
            disabled={!data.canEdit || save.isPending}
            value={data.notesEnabled ? 'on' : 'off'}
            onChange={(e) => save.mutate({ notesEnabled: e.target.value === 'on' })}
          >
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </div>
        <div className="cfg-line">
          <Icon name="groups_3" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Book Club</div>
            <div className="cl-d">Persistent reading groups with per-book chat.</div>
          </div>
          <select
            className="fld"
            style={{ width: 'auto' }}
            disabled={!data.canEdit || save.isPending}
            value={data.clubsEnabled ? 'on' : 'off'}
            onChange={(e) => save.mutate({ clubsEnabled: e.target.value === 'on' })}
          >
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </div>
      </div>

      <TelemetrySection />
    </>
  )
}

// Anonymous usage stats opt-in (off by default). Full disclosure of exactly what
// is sent + a live preview of the payload, so the choice is informed. Only an
// admin can flip it; the aggregate feeds hearthshelf.com/stats.
function TelemetrySection() {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: hostedKeys.telemetry(target?.serverId ?? ''),
    queryFn: () => getTelemetryConfig(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const save = useMutation({
    mutationFn: (enabled: boolean) => setTelemetryEnabled(target!, enabled),
    onSuccess: (next: { enabled: boolean; canEdit: boolean }) => {
      qc.setQueryData<TelemetryConfig | undefined>(
        hostedKeys.telemetry(target!.serverId),
        (cur) => (cur ? { ...cur, enabled: next.enabled } : cur),
      )
      show(next.enabled ? 'Thanks - anonymous stats are on' : 'Anonymous stats turned off')
    },
    onError: () => show('Could not save - admin permission required'),
  })

  if (!data) return null
  const p = data.payloadPreview

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="insights" />
        <h2>Anonymous usage stats</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="bar_chart" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Share anonymous stats</div>
            <div className="cl-d">
              Help improve HearthShelf and power the public stats page. Off by default.
            </div>
          </div>
          <select
            className="fld"
            style={{ width: 'auto' }}
            disabled={!data.canEdit || save.isPending}
            value={data.enabled ? 'on' : 'off'}
            onChange={(e) => save.mutate(e.target.value === 'on')}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </div>

        <div className="banner info" style={{ marginTop: 'var(--s4)', display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Icon name="verified_user" />
            <strong>What we send</strong>
          </div>
          Coarse numbers only - no names, emails, book titles, IP addresses, or your server's
          identity. A random anonymous id lets us count active installs without knowing who they
          are. Here is exactly what a report would contain right now:
          <pre
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 'var(--r-row)',
              background: 'var(--surface-2, rgba(0,0,0,0.25))',
              fontSize: 12,
              overflowX: 'auto',
              color: 'var(--text-muted)',
            }}
          >
            {JSON.stringify(
              {
                anonymous_id: p.telemetry_id,
                hearthshelf_version: p.hs_version,
                audiobookshelf_version: p.abs_version,
                mode: p.mode,
                users: p.user_bucket,
                library_size: p.book_bucket,
                quests_given: p.quests_given,
                quests_accepted: p.quests_accepted,
                books_finished: p.books_finished,
                club_books_finished: p.club_books_finished,
                clubs_active: p.clubs_active,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </div>
    </>
  )
}
