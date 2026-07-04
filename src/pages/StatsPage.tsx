import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getListeningStatsFull, type ListeningStatsFull } from '@/api/absStats'
import { getLeaderboard, socialKeys, type LeaderboardResponse } from '@/api/absSocial'
import type { LeaderboardWindow } from '@hearthshelf/core'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

const WINDOWS: { id: LeaderboardWindow; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All time' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Heads every section: icon + title (matches the design's section-head markup).
function SectionHead({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="section-head">
      <Icon name={icon} />
      <h2>{title}</h2>
    </div>
  )
}

// Whole hours, for the compact leaderboard listening column.
function hoursLabel(seconds: number): string {
  return `${Math.floor(seconds / 3600)}h`
}

// Build a stable YYYY-MM-DD key in local time (matches ABS's byDay keys).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export function StatsPage() {
  const { target } = useActiveServer()
  const [window, setWindow] = useState<LeaderboardWindow>('all')

  const { data, isLoading, isError, refetch } = useQuery<ListeningStatsFull>({
    queryKey: ['abs-stats-full', target?.serverId],
    queryFn: () => getListeningStatsFull(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Cross-user leaderboard (the connected server's HearthShelf backend). Degrades
  // to an unavailable response when the server doesn't expose social, in which
  // case we hide the whole section rather than show an error. Window pills only
  // render once the server confirms windowing support (windowsAvailable).
  const { data: leaderboard } = useQuery<LeaderboardResponse>({
    queryKey: socialKeys.leaderboard(target?.serverId ?? '', window),
    queryFn: () => getLeaderboard(target!, window),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const lbEntries = leaderboard?.available ? leaderboard.entries : []
  const showWindowPills = Boolean(leaderboard?.available && leaderboard.windowsAvailable)

  // Top items by listening time, resolved with cover + metadata.
  const mostListened = useMemo(() => {
    if (!data) return []
    return data.items
      .map((it) => ({
        id: it.id,
        title: it.title,
        author: it.author,
        narrator: it.narrator,
        hours: it.timeListeningSec / 3600,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8)
  }, [data])
  const mlMax = mostListened[0]?.hours || 1

  // Last 7 calendar days from the days map (date string -> seconds).
  const week = useMemo(() => {
    if (!data) return [] as { d: string; v: number }[]
    const out: { d: string; v: number }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      out.push({
        d: DAY_LABELS[day.getDay()],
        v: Math.round(((data.byDay[dayKey(day)] ?? 0) / 3600) * 10) / 10,
      })
    }
    return out
  }, [data])
  const weekMax = Math.max(0.1, ...week.map((d) => d.v))
  const hotIdx = week.length ? week.reduce((m, d, i) => (d.v > week[m].v ? i : m), 0) : 0

  // Last 26 weeks (182 days) of listening, as a heatmap. Each cell's opacity
  // scales with that day's minutes against the busiest day in the window.
  const heat = useMemo(() => {
    if (!data) return [] as { key: string; ratio: number; mins: number }[]
    const cells: { key: string; ratio: number; mins: number }[] = []
    const now = new Date()
    let max = 1
    for (let i = 181; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dayKey(day)
      const mins = Math.round((data.byDay[key] ?? 0) / 60)
      max = Math.max(max, mins)
      cells.push({ key, ratio: 0, mins })
    }
    for (const c of cells) c.ratio = c.mins / max
    return cells
  }, [data])

  if (!target) return null

  if (isLoading) {
    return (
      <div className="page fade-in">
        <LoadingSpinner className="py-12" label="Loading stats..." />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="page fade-in">
        <ErrorState message="Could not load your stats." onRetry={refetch} />
      </div>
    )
  }

  const totalH = Math.floor(data.totalTimeSec / 3600)
  const totalM = Math.floor((data.totalTimeSec % 3600) / 60)
  const bookCount = data.items.length
  const todayMin = Math.round(data.todaySec / 60)
  const activeDays = Object.keys(data.byDay).filter((k) => data.byDay[k] > 0).length

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Insights</div>
        <h1 className="title-xl">Your stats</h1>
      </div>

      <div className="hero-stat">
        <div className="label">Total listening time</div>
        <div className="big-num">
          {totalH}
          <u>h</u>
          {totalM}
          <u>m</u>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          across {bookCount} {bookCount === 1 ? 'book' : 'books'}
        </div>
      </div>

      <div className="stat-tiles">
        <div className="tile">
          <div className="t-ico">
            <Icon name="menu_book" />
          </div>
          <div className="t-num">{bookCount}</div>
          <div className="t-cap">Books listened</div>
        </div>
        <div className="tile">
          <div className="t-ico">
            <Icon name="calendar_today" />
          </div>
          <div className="t-num">{activeDays}</div>
          <div className="t-cap">Active days</div>
        </div>
        <div className="tile">
          <div
            className="t-ico"
            style={
              todayMin > 0
                ? {
                    background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
                    color: 'var(--accent)',
                  }
                : undefined
            }
          >
            <Icon name="local_fire_department" fill={todayMin > 0} />
          </div>
          <div className="t-num">{todayMin}m</div>
          <div className="t-cap">Today</div>
        </div>
      </div>

      {mostListened.length > 0 && (
        <div className="section">
          <SectionHead icon="trending_up" title="Most listened to" />
          <div className="chart-card" style={{ marginTop: 0 }}>
            <div className="ml-list">
              {mostListened.map((b, i) => (
                <div className="ml-row" key={b.id} data-cv={tintFor(b.title)}>
                  <span className="ml-rank">{i + 1}</span>
                  <Cover itemId={b.id} title={b.title} fs={4} />
                  <div className="ml-meta">
                    <div className="ml-t">{b.title}</div>
                    <div className="ml-s">{[b.author, b.narrator].filter(Boolean).join(' · ')}</div>
                    <div className="ml-bar">
                      <i style={{ width: (b.hours / mlMax) * 100 + '%' }} />
                    </div>
                  </div>
                  <span className="ml-h">
                    {b.hours.toFixed(1)}
                    <small>h</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="chart-card">
        <SectionHead icon="bar_chart" title="Last 7 days" />
        <div className="bars">
          {week.map((d, i) => (
            <div className={'bar-col' + (i === hotIdx ? ' hot' : '')} key={i}>
              <span className="v">{d.v}h</span>
              <div className="bar" style={{ height: (d.v / weekMax) * 100 + '%' }} />
              <span className="d">{d.d}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card" style={{ marginTop: 'var(--s6)' }}>
        <SectionHead icon="calendar_month" title="Last 6 months" />
        <div className="heatmap">
          {heat.map((c) => (
            <i
              key={c.key}
              title={`${c.key}: ${c.mins} min`}
              style={
                c.ratio > 0
                  ? {
                      background: `color-mix(in oklab, var(--accent) ${Math.round(
                        18 + c.ratio * 82,
                      )}%, var(--c-highest))`,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {lbEntries.length > 0 && (
        <div className="section">
          <SectionHead icon="groups" title="Leaderboard" />
          {showWindowPills && (
            <div className="toolbar2" style={{ marginBottom: 12 }}>
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  className={'pill' + (window === w.id ? ' on' : '')}
                  onClick={() => setWindow(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
          <div className="chart-card" style={{ marginTop: 0 }}>
            <div className="ml-list">
              {lbEntries.map((e) => (
                <div
                  className={'ml-row' + (e.isMe ? ' hot' : '')}
                  key={e.userId}
                  data-cv={tintFor(e.username)}
                >
                  <span className="ml-rank">{e.rank}</span>
                  <Avatar name={e.username} target={target} userId={e.userId} size={40} />
                  <div className="ml-meta">
                    <div className="ml-t">
                      {e.username}
                      {e.isMe && <small style={{ marginLeft: 6 }}>(you)</small>}
                    </div>
                    <div className="ml-s">{hoursLabel(e.secondsListened)} listened</div>
                  </div>
                  <span className="ml-h">
                    {e.booksFinished}
                    <small>{e.booksFinished === 1 ? 'book' : 'books'}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
