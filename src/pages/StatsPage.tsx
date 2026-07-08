import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getHsStats,
  getStatsHistory,
  getListeningStatsFull,
  statsKeys,
  type ListeningStatsFull,
} from '@/api/absStats'
import {
  getLeaderboard,
  getCompare,
  socialKeys,
  type LeaderboardResponse,
} from '@/api/absSocial'
import {
  activeDays as computeActiveDays,
  dayOfWeekTotals,
  avgPerActiveDay,
  avgSession,
  type HSListeningStats,
  type HSStatsHistory,
  type HSCompareResponse,
  type LeaderboardWindow,
} from '@hearthshelf/core'
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
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

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

// Compact "3h 20m" / "45m" from seconds, for stat tiles.
function hmLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// Build a stable YYYY-MM-DD key in local time (matches ABS's byDay keys).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// A single view-model both the HS-stats path and the ABS-native fallback produce,
// so the page renders identically regardless of source. HS fields the fallback
// can't reach (finished counts, session count) stay null.
interface StatsVM {
  totalTimeSec: number
  todaySec: number
  activeDays: number
  byDay: Record<string, number>
  byDayOfWeek: Record<string, number>
  mostListened: { id: string; title: string; author: string; narrator: string; timeSec: number }[]
  bookCount: number
  dayStreak: number
  booksThisYear: number | null
  sessionCount: number | null
}

function vmFromHs(s: HSListeningStats): StatsVM {
  return {
    totalTimeSec: s.totalTimeSec,
    todaySec: s.todaySec,
    activeDays: s.activeDays,
    byDay: s.byDay,
    byDayOfWeek: s.byDayOfWeek,
    mostListened: s.mostListened,
    bookCount: s.mostListened.length,
    dayStreak: s.dayStreak,
    booksThisYear: s.booksThisYear,
    sessionCount: s.sessionCount,
  }
}

// The ABS-native fallback lacks the server-computed fields, so derive what we can
// (active days + day-of-week) client-side via the shared Core helpers and leave
// the ABS-db-only fields null.
function vmFromFallback(s: ListeningStatsFull): StatsVM {
  return {
    totalTimeSec: s.totalTimeSec,
    todaySec: s.todaySec,
    activeDays: computeActiveDays(s.byDay),
    byDay: s.byDay,
    byDayOfWeek: dayOfWeekTotals(null),
    mostListened: s.items.map((it) => ({
      id: it.id,
      title: it.title,
      author: it.author,
      narrator: it.narrator,
      timeSec: it.timeListeningSec,
    })),
    bookCount: s.items.length,
    dayStreak: 0,
    booksThisYear: null,
    sessionCount: null,
  }
}

export function StatsPage() {
  const { target } = useActiveServer()
  const [window, setWindow] = useState<LeaderboardWindow>('all')

  // Primary: the server's HearthShelf backend (/hs/stats), richer than ABS's own
  // payload. Returns null on a slim/older server, and the fallback query below
  // fills in from the ABS-native endpoint so the page always renders.
  const {
    data: hs,
    isLoading: hsLoading,
    isError: hsError,
    refetch: refetchHs,
  } = useQuery<HSListeningStats | null>({
    queryKey: statsKeys.hsStats(target?.serverId ?? ''),
    queryFn: () => getHsStats(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })
  const hsAvailable = hs != null

  const {
    data: fallback,
    isLoading: fbLoading,
    isError: fbError,
    refetch: refetchFb,
  } = useQuery<ListeningStatsFull>({
    queryKey: ['abs-stats-full', target?.serverId],
    queryFn: () => getListeningStatsFull(target!),
    // Only pay for the ABS-native read when /hs/stats didn't resolve.
    enabled: Boolean(target) && !hsLoading && !hsAvailable,
    staleTime: 60 * 1000,
  })

  const stats: StatsVM | null = useMemo(() => {
    if (hs) return vmFromHs(hs)
    if (fallback) return vmFromFallback(fallback)
    return null
  }, [hs, fallback])

  // Durable listening history (the snapshot job's output). Powers the full-year
  // heatmap; when unavailable we fall back to the trailing byDay window below.
  const { data: history } = useQuery<HSStatsHistory>({
    queryKey: statsKeys.history(target?.serverId ?? '', 'year'),
    queryFn: () => getStatsHistory(target!, 'year'),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
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

  // Compare: the caller vs the server average (default) or a chosen opted-in user.
  // The user picker draws only from the leaderboard roster (already privacy-
  // filtered server-side). Hidden entirely when the server can't compare.
  const [compareUserId, setCompareUserId] = useState<string>('')
  const { data: compare } = useQuery<HSCompareResponse>({
    queryKey: socialKeys.compare(target?.serverId ?? '', compareUserId),
    queryFn: () => getCompare(target!, compareUserId ? { userId: compareUserId } : {}),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })

  // Top items by listening time, resolved with cover + metadata.
  const mostListened = useMemo(() => {
    if (!stats) return []
    return stats.mostListened
      .map((it) => ({
        id: it.id,
        title: it.title,
        author: it.author,
        narrator: it.narrator,
        hours: it.timeSec / 3600,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8)
  }, [stats])
  const mlMax = mostListened[0]?.hours || 1

  // Last 7 calendar days from the days map (date string -> seconds).
  const week = useMemo(() => {
    if (!stats) return [] as { d: string; v: number }[]
    const out: { d: string; v: number }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      out.push({
        d: DAY_LABELS[day.getDay()],
        v: Math.round(((stats.byDay[dayKey(day)] ?? 0) / 3600) * 10) / 10,
      })
    }
    return out
  }, [stats])
  const weekMax = Math.max(0.1, ...week.map((d) => d.v))
  const hotIdx = week.length ? week.reduce((m, d, i) => (d.v > week[m].v ? i : m), 0) : 0

  // Per-weekday totals ('0'..'6' Sun..Sat), as hours, for the day-of-week bars.
  const dow = useMemo(() => {
    if (!stats) return [] as { d: string; v: number }[]
    return DAY_LABELS.map((label, i) => ({
      d: label,
      v: Math.round(((stats.byDayOfWeek[String(i)] ?? 0) / 3600) * 10) / 10,
    }))
  }, [stats])
  const dowMax = Math.max(0.1, ...dow.map((d) => d.v))
  const dowHotIdx = dow.length ? dow.reduce((m, d, i) => (d.v > dow[m].v ? i : m), 0) : 0
  const hasDow = dow.some((d) => d.v > 0)

  // Full-year heatmap from durable history when available: one cell per day for
  // the last ~53 weeks, aligned so each column is a week (Sun..Sat top to bottom).
  const yearHeat = useMemo(() => {
    if (!history?.available || history.days.length === 0) return null
    const byDate = new Map(history.days.map((d) => [d.date, d.secondsListened]))
    const now = new Date()
    // Start on the Sunday on/before 52 weeks ago so columns are whole weeks.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * 52)
    start.setDate(start.getDate() - start.getDay())
    const cells: { key: string; mins: number; ratio: number; month: number }[] = []
    let max = 1
    const cur = new Date(start)
    while (cur <= now) {
      const key = dayKey(cur)
      const mins = Math.round((byDate.get(key) ?? 0) / 60)
      max = Math.max(max, mins)
      cells.push({ key, mins, ratio: 0, month: cur.getMonth() })
      cur.setDate(cur.getDate() + 1)
    }
    for (const c of cells) c.ratio = c.mins / max
    // Month labels: the first column whose first day lands in a new month.
    const weeks = Math.ceil(cells.length / 7)
    const monthCols: { col: number; label: string }[] = []
    let lastMonth = -1
    for (let col = 0; col < weeks; col++) {
      const first = cells[col * 7]
      if (first && first.month !== lastMonth) {
        monthCols.push({ col, label: MONTH_LABELS[first.month] })
        lastMonth = first.month
      }
    }
    return { cells, weeks, monthCols }
  }, [history])

  // Fallback heatmap: last 26 weeks (182 days) from the trailing byDay window.
  const heat = useMemo(() => {
    if (!stats) return [] as { key: string; ratio: number; mins: number }[]
    const cells: { key: string; ratio: number; mins: number }[] = []
    const now = new Date()
    let max = 1
    for (let i = 181; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dayKey(day)
      const mins = Math.round((stats.byDay[key] ?? 0) / 60)
      max = Math.max(max, mins)
      cells.push({ key, ratio: 0, mins })
    }
    for (const c of cells) c.ratio = c.mins / max
    return cells
  }, [stats])

  if (!target) return null

  const isLoading = hsLoading || (!hsAvailable && fbLoading)
  if (isLoading && !stats) {
    return (
      <div className="page fade-in">
        <LoadingSpinner className="py-12" label="Loading stats..." />
      </div>
    )
  }

  if ((hsError && fbError) || (!stats && !hsLoading && !fbLoading)) {
    return (
      <div className="page fade-in">
        <ErrorState
          message="Could not load your stats."
          onRetry={() => {
            refetchHs()
            refetchFb()
          }}
        />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="page fade-in">
        <LoadingSpinner className="py-12" label="Loading stats..." />
      </div>
    )
  }

  const totalH = Math.floor(stats.totalTimeSec / 3600)
  const totalM = Math.floor((stats.totalTimeSec % 3600) / 60)
  const bookCount = stats.bookCount
  const todayMin = Math.round(stats.todaySec / 60)
  const avgDaySec = avgPerActiveDay(stats.totalTimeSec, stats.activeDays)
  const avgSessSec = stats.sessionCount ? avgSession(stats.totalTimeSec, stats.sessionCount) : 0

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
        {stats.booksThisYear != null && (
          <div className="tile">
            <div className="t-ico">
              <Icon name="event_available" />
            </div>
            <div className="t-num">{stats.booksThisYear}</div>
            <div className="t-cap">This year</div>
          </div>
        )}
        <div className="tile">
          <div className="t-ico">
            <Icon name="calendar_today" />
          </div>
          <div className="t-num">{stats.activeDays}</div>
          <div className="t-cap">Active days</div>
        </div>
        {stats.dayStreak > 0 && (
          <div className="tile">
            <div
              className="t-ico"
              style={{
                background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
                color: 'var(--accent)',
              }}
            >
              <Icon name="local_fire_department" fill />
            </div>
            <div className="t-num">{stats.dayStreak}</div>
            <div className="t-cap">Day streak</div>
          </div>
        )}
        <div className="tile">
          <div className="t-ico">
            <Icon name="hourglass_top" />
          </div>
          <div className="t-num">{hmLabel(avgDaySec)}</div>
          <div className="t-cap">Avg / active day</div>
        </div>
        {stats.sessionCount != null && stats.sessionCount > 0 && (
          <div className="tile">
            <div className="t-ico">
              <Icon name="play_circle" />
            </div>
            <div className="t-num">{hmLabel(avgSessSec)}</div>
            <div className="t-cap">Avg session</div>
          </div>
        )}
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
            <Icon name="today" fill={todayMin > 0} />
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

      {hasDow && (
        <div className="chart-card" style={{ marginTop: 'var(--s6)' }}>
          <SectionHead icon="date_range" title="By day of week" />
          <div className="bars">
            {dow.map((d, i) => (
              <div className={'bar-col' + (i === dowHotIdx ? ' hot' : '')} key={i}>
                <span className="v">{d.v}h</span>
                <div className="bar" style={{ height: (d.v / dowMax) * 100 + '%' }} />
                <span className="d">{d.d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {yearHeat ? (
        <div className="chart-card" style={{ marginTop: 'var(--s6)' }}>
          <SectionHead icon="calendar_month" title="This year" />
          <div className="heatmap-wrap">
            <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${yearHeat.weeks}, 1fr)` }}>
              {yearHeat.monthCols.map((m) => (
                <span key={m.col} style={{ gridColumn: m.col + 1 }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div
              className="heatmap-year"
              style={{ gridTemplateColumns: `repeat(${yearHeat.weeks}, 1fr)` }}
            >
              {yearHeat.cells.map((c) => (
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
        </div>
      ) : (
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
      )}

      {compare?.available && (
        <CompareCard
          compare={compare}
          users={lbEntries}
          selectedUserId={compareUserId}
          onSelectUser={setCompareUserId}
        />
      )}

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

// Me-vs-target comparison. `target` is the server per-user average (scope server)
// or a chosen opted-in user (scope user). Active-days omitted when the target
// doesn't carry it (the server aggregate).
function CompareCard({
  compare,
  users,
  selectedUserId,
  onSelectUser,
}: {
  compare: HSCompareResponse
  users: { userId: string; username: string; isMe: boolean }[]
  selectedUserId: string
  onSelectUser: (id: string) => void
}) {
  const others = users.filter((u) => !u.isMe)
  const targetLabel =
    compare.scope === 'user' ? compare.username || 'That listener' : 'Server average'

  const rows: { label: string; me: number; target: number; fmt: (n: number) => string }[] = [
    {
      label: 'Books finished',
      me: compare.me.booksFinished,
      target: compare.target.booksFinished,
      fmt: (n) => String(Math.round(n)),
    },
    {
      label: 'Hours listened',
      me: compare.me.secondsListened / 3600,
      target: compare.target.secondsListened / 3600,
      fmt: (n) => `${n.toFixed(1)}h`,
    },
  ]
  if (compare.me.activeDays != null && compare.target.activeDays != null) {
    rows.push({
      label: 'Active days',
      me: compare.me.activeDays,
      target: compare.target.activeDays,
      fmt: (n) => String(Math.round(n)),
    })
  }

  return (
    <div className="section">
      <SectionHead icon="compare_arrows" title="Compare" />
      <div className="toolbar2" style={{ marginBottom: 12 }}>
        <button
          className={'pill' + (compare.scope === 'server' && !selectedUserId ? ' on' : '')}
          onClick={() => onSelectUser('')}
        >
          Server average
        </button>
        {others.length > 0 && (
          <select
            className="compare-picker"
            value={selectedUserId}
            onChange={(e) => onSelectUser(e.target.value)}
          >
            <option value="">Pick a user...</option>
            {others.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.username}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="chart-card" style={{ marginTop: 0 }}>
        <div className="compare-head">
          <span>You</span>
          <span>{targetLabel}</span>
        </div>
        {rows.map((r) => {
          const max = Math.max(r.me, r.target, 0.001)
          return (
            <div className="compare-row" key={r.label}>
              <div className="compare-label">{r.label}</div>
              <div className="compare-bars">
                <div className="compare-side me">
                  <div className="compare-bar">
                    <i style={{ width: (r.me / max) * 100 + '%' }} />
                  </div>
                  <span className="compare-val">{r.fmt(r.me)}</span>
                </div>
                <div className="compare-side target">
                  <div className="compare-bar">
                    <i style={{ width: (r.target / max) * 100 + '%' }} />
                  </div>
                  <span className="compare-val">{r.fmt(r.target)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
