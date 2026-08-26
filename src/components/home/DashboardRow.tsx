/**
 * Home's dashboard band: an "Up next" queue peek beside the listening streak.
 * Two small cards - the left opens the player's queue, the right goes to Stats.
 *
 * The streak card calls out a streak on the line (a run going, but nothing
 * listened today) since that's the one moment the number is actionable.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { formatDuration, queueLengthLabel, type HSListeningStats } from '@hearthshelf/core'
import { getHsStats, statsKeys } from '@/api/absStats'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useQueueStore } from '@/store/queueStore'
import { useSettingsStore } from '@/store/settingsStore'
import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'

const QUEUE_MODE_LABELS: Record<string, string> = {
  off: 'Off',
  manual: 'Manual',
  series: 'Series',
  auto: 'Auto',
}

export function DashboardRow() {
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const items = useQueueStore((s) => s.items)
  const queueMode = useSettingsStore((s) => s.queueMode)

  // Shares StatsPage's cache entry, so this is free whenever Stats was visited.
  const { data: stats } = useQuery<HSListeningStats | null>({
    queryKey: statsKeys.hsStats(target?.serverId ?? ''),
    queryFn: () => getHsStats(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const preview = items.slice(0, 3)
  const modeLabel = QUEUE_MODE_LABELS[queueMode] ?? 'Off'
  // Streak nudge: nothing listened today, but there's a run to protect.
  const streakAtRisk = stats != null && stats.todaySec === 0 && stats.dayStreak > 0

  return (
    <div className="dash-row">
      <button type="button" className="dash-card" onClick={() => navigate('/player')}>
        <div className="dash-head">
          <span>Up next</span>
          <Icon name="queue_music" />
        </div>
        {preview.length > 0 && (
          <div className="dash-covers">
            {preview.map((e, i) => (
              <span key={e.libraryItemId} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                <Cover
                  itemId={e.libraryItemId}
                  title={e.title}
                  fs={5}
                  style={{ width: 26, borderRadius: 4, display: 'block' }}
                />
              </span>
            ))}
          </div>
        )}
        {/* Count + total runtime, same line the player's queue tray shows, so
            the two never disagree about how much is queued. Mode moves to its
            own line rather than being appended - the length line is long
            enough on its own. */}
        <div className="dash-cap">
          {items.length > 0 ? queueLengthLabel(items) : `Nothing queued · ${modeLabel}`}
        </div>
        {items.length > 0 && <div className="dash-cap-sub">{modeLabel}</div>}
      </button>

      <button type="button" className="dash-card" onClick={() => navigate('/stats')}>
        <div className="dash-stat">
          <Icon name="local_fire_department" fill style={{ color: 'var(--brand-hearth)' }} />
          <b className="dash-big">{stats ? String(stats.dayStreak) : '–'}</b>
          <span>days</span>
        </div>
        {streakAtRisk ? (
          <div className="dash-cap">streak on the line - listen today to keep it</div>
        ) : (
          <div className="dash-stat" style={{ marginTop: 8 }}>
            <Icon name="schedule" />
            <b>{stats ? formatDuration(stats.weekSec) : '–'}</b>
            <span>this week</span>
          </div>
        )}
      </button>
    </div>
  )
}
