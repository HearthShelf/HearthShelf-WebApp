import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getCommunityConfig, socialKeys } from '@/api/absSocial'

/**
 * Connections: external/social account links, plus what this server's
 * community can see about you.
 *
 * In the hosted front door, Clerk owns identity, so connected social accounts
 * (Google, Apple, etc.) are managed in the Profile & sign-in tab, not here -
 * we point there rather than duplicating Clerk's connected-accounts UI.
 *
 * The self-hosted app also surfaces server-side integrations here (ReadMeABook,
 * external book links). Those live on the HearthShelf Node backend, which the
 * hosted SPA does not talk to (it speaks straight to ABS), so they're admin-
 * managed on the server and we just note where to find them.
 */
export function ConnectionsSettings() {
  return (
    <section>
      <div className="section-head">
        <Icon name="hub" />
        <h2>Connections</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Where your linked accounts and server integrations live.
      </p>

      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="link" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Connected accounts</div>
            <div className="cl-d">
              Google, Apple and other sign-in providers are managed by your HearthShelf account.
              Open the Profile &amp; sign-in tab to connect or remove them.
            </div>
          </div>
        </div>
      </div>

      <div className="cfg-card" style={{ marginTop: 'var(--s4)' }}>
        <div className="cfg-line">
          <Icon name="hub" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Server integrations</div>
            <div className="cl-d">
              ReadMeABook, external book links (Goodreads, Audible, Hardcover) and similar
              integrations are set up by your server admin under Server &rarr; Integrations on the
              server itself.
            </div>
          </div>
        </div>
      </div>

      <CommunitySharing />
    </section>
  )
}

// What other listeners on the active server can see about you. Both settings
// are tri-state: null = never chose, so they follow the server's community
// default until you pick for yourself.
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
                ? `Appear on the server leaderboard and "finished by" lists with your name. Following the server default (currently ${defaultShare ? 'shared' : 'hidden'}) until you choose.`
                : 'Appear on the server leaderboard and "finished by" lists with your name. Turn this off to stay hidden.'}
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
                ? `Let other listeners see you're currently listening to a book. Following the server default (currently ${defaultShareListening ? 'shared' : 'hidden'}) until you choose.`
                : "Let other listeners see you're currently listening to a book. Turn this off to stay hidden."}
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
