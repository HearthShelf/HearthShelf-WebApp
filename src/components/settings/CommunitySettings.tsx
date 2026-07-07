import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getCommunityConfig, socialKeys } from '@/api/absSocial'

export function CommunitySettings() {
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
    <section>
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
    </section>
  )
}
