import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useSettingsStore } from '@/store/settingsStore'
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
  dayOfWeekAverages,
  avgPerActiveDay,
  avgSession,
  type HSListeningStats,
  type HSStatsHistory,
  type HSStatsHighlights,
  type HSStatsMonth,
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

type DowMode = 'last7' | 'total' | 'average'
const DOW_MODES: { id: DowMode; label: string }[] = [
  { id: 'last7', label: 'Last 7' },
  { id: 'total', label: 'Total' },
  { id: 'average', label: 'Average' },
]
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

// Bar value label from hours: whole/decimal hours at >=1h, minutes below that so
// sub-hour averages don't all read "0.3h". "0" for empty bars.
function barValueLabel(hours: number): string {
  if (hours <= 0) return '0'
  if (hours >= 1) return `${hours}h`
  return `${Math.round(hours * 60)}m`
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
  byWeekdayAvg: Record<string, number>
  mostListened: { id: string; title: string; author: string; narrator: string; timeSec: number }[]
  bookCount: number
  dayStreak: number
  booksThisYear: number | null
  sessionCount: number | null
  highlights: HSStatsHighlights | null
}

function vmFromHs(s: HSListeningStats): StatsVM {
  return {
    totalTimeSec: s.totalTimeSec,
    todaySec: s.todaySec,
    activeDays: s.activeDays,
    byDay: s.byDay,
    byDayOfWeek: s.byDayOfWeek,
    byWeekdayAvg: s.byWeekdayAvg ?? dayOfWeekAverages(s.byDay),
    mostListened: s.mostListened,
    bookCount: s.mostListened.length,
    dayStreak: s.dayStreak,
    booksThisYear: s.booksThisYear,
    sessionCount: s.sessionCount,
    highlights: s.highlights ?? null,
  }
}

// The ABS-native fallback lacks the server-computed fields, so derive what we can
// from byDay via the shared Core helpers and leave the ABS-db-only fields null.
// byDayOfWeek (total) needs ABS's raw dayOfWeek map, which the fallback payload
// doesn't carry, so it stays empty; byWeekdayAvg is derivable from byDay alone.
function vmFromFallback(s: ListeningStatsFull): StatsVM {
  return {
    totalTimeSec: s.totalTimeSec,
    todaySec: s.todaySec,
    activeDays: computeActiveDays(s.byDay),
    byDay: s.byDay,
    byDayOfWeek: dayOfWeekTotals(null),
    byWeekdayAvg: dayOfWeekAverages(s.byDay),
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
    highlights: null,
  }
}

export function StatsPage() {
  const { target } = useActiveServer()
  const [window, setWindow] = useState<LeaderboardWindow>('all')
  const yearlyBookGoal = useSettingsStore((s) => s.yearlyBookGoal)
  const setSetting = useSettingsStore((s) => s.set)
  const [dowMode, setDowMode] = useState<DowMode>('last7')

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

  // Highlight badges replace "Most listened to" when the server supplies them
  // (db-derived). At least one populated field is required to show the grid;
  // otherwise we fall back to the most-listened list.
  const h = stats?.highlights
  const hasHighlights = Boolean(
    h && (h.longestBook || h.shortestBook || h.topAuthor || h.topNarrator || h.mostReRead),
  )

  // One listening bar chart with three server-computed views:
  //   last7   - the 7 most recent calendar days (byDay)
  //   total   - total time per weekday, Sun..Sat (byDayOfWeek, a running sum)
  //   average - average time per occurrence of each weekday (byWeekdayAvg)
  // Hours to one decimal. `bars` carries a per-bar label + value; `hot` flags the
  // busiest bar. The value formatter differs (average shows m under ~1h).
  const bars = useMemo(() => {
    if (!stats) return [] as { d: string; v: number }[]
    if (dowMode === 'last7') {
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
    }
    const src = dowMode === 'average' ? stats.byWeekdayAvg : stats.byDayOfWeek
    return DAY_LABELS.map((label, i) => ({
      d: label,
      v: Math.round(((src[String(i)] ?? 0) / 3600) * 10) / 10,
    }))
  }, [stats, dowMode])
  const barsMax = Math.max(0.1, ...bars.map((d) => d.v))
  const barsHot = bars.length ? bars.reduce((m, d, i) => (d.v > bars[m].v ? i : m), 0) : 0
  // Every bar zero: an empty account, or the current view has no data yet. Show a
  // friendly note instead of a row of flat zero-bars.
  const barsEmpty = !bars.some((d) => d.v > 0)

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
            <div className="t-cap">Books this year</div>
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

      <GoalCard
        goal={yearlyBookGoal}
        booksThisYear={stats.booksThisYear}
        onSetGoal={(n) => setSetting('yearlyBookGoal', n)}
      />

      {hasHighlights ? (
        <HighlightsSection highlights={stats.highlights!} />
      ) : (
        mostListened.length > 0 && (
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
                      <div className="ml-s">
                        {[b.author, b.narrator].filter(Boolean).join(' · ')}
                      </div>
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
        )
      )}

      <div className="chart-card">
        <div className="chart-card-head">
          <SectionHead
            icon="bar_chart"
            title={dowMode === 'last7' ? 'Last 7 days' : 'By day of week'}
          />
          <div className="toolbar2">
            {DOW_MODES.map((m) => (
              <button
                key={m.id}
                className={'pill' + (dowMode === m.id ? ' on' : '')}
                onClick={() => setDowMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-sub">
          {dowMode === 'last7'
            ? 'Hours listened each of the last 7 days'
            : dowMode === 'total'
              ? 'Total hours listened on each weekday'
              : 'Average hours per weekday'}
        </div>
        {barsEmpty ? (
          <div className="chart-empty">No listening yet.</div>
        ) : (
          <div className="bars">
            {bars.map((d, i) => (
              <div className={'bar-col' + (i === barsHot ? ' hot' : '')} key={i}>
                <span className="v">{barValueLabel(d.v)}</span>
                <div className="bar" style={{ height: (d.v / barsMax) * 100 + '%' }} />
                <span className="d">{d.d}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {history?.available && <MonthCard months={history.months ?? []} />}

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

  // Every shared stat, side by side. A row is included only when BOTH sides
  // carry the value (older servers omit the newer fields; the server aggregate
  // has no activeDays), so nothing renders a misleading 0-vs-real bar.
  const roundInt = (n: number) => String(Math.round(n))
  const hoursFmt = (n: number) => `${n.toFixed(1)}h`
  const specs: {
    label: string
    me: number | null | undefined
    target: number | null | undefined
    fmt: (n: number) => string
  }[] = [
    {
      label: 'Books finished',
      me: compare.me.booksFinished,
      target: compare.target.booksFinished,
      fmt: roundInt,
    },
    {
      label: 'Hours listened',
      me: compare.me.secondsListened / 3600,
      target: compare.target.secondsListened / 3600,
      fmt: hoursFmt,
    },
    {
      label: 'Books this year',
      me: compare.me.booksThisYear,
      target: compare.target.booksThisYear,
      fmt: roundInt,
    },
    {
      label: 'Active days',
      me: compare.me.activeDays,
      target: compare.target.activeDays,
      fmt: roundInt,
    },
    {
      label: 'Avg / active day',
      me: compare.me.avgPerActiveDaySec != null ? compare.me.avgPerActiveDaySec / 3600 : undefined,
      target:
        compare.target.avgPerActiveDaySec != null
          ? compare.target.avgPerActiveDaySec / 3600
          : undefined,
      fmt: hoursFmt,
    },
  ]
  const rows = specs.filter(
    (s): s is { label: string; me: number; target: number; fmt: (n: number) => string } =>
      typeof s.me === 'number' && typeof s.target === 'number',
  )

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

// Fraction of the current calendar year elapsed (0..1), for the "on pace" hint.
function yearElapsedFraction(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1).getTime()
  const end = new Date(now.getFullYear() + 1, 0, 1).getTime()
  return (now.getTime() - start) / (end - start)
}

// A circular SVG progress ring. `frac` is clamped 0..1; the ring uses the accent
// with the track in the neutral surface, matching the heatmap/bars palette.
function ProgressRing({ frac, label, sub }: { frac: number; label: string; sub: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, frac))
  return (
    <div className="goal-ring">
      <svg viewBox="0 0 120 120" width="120" height="120">
        <circle className="goal-ring-track" cx="60" cy="60" r={r} fill="none" strokeWidth="10" />
        <circle
          className="goal-ring-fill"
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="goal-ring-center">
        <div className="goal-ring-num">{label}</div>
        <div className="goal-ring-sub">{sub}</div>
      </div>
    </div>
  )
}

// Yearly reading goal: progress toward finishing N books this calendar year.
// Editable inline; when no goal is set (0) it invites the user to set one.
// booksThisYear is null when the ABS database isn't mounted - then we can show
// the target but not real progress, so we say so instead of faking a ring.
function GoalCard({
  goal,
  booksThisYear,
  onSetGoal,
}: {
  goal: number
  booksThisYear: number | null
  onSetGoal: (n: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(goal || ''))

  const startEdit = () => {
    setDraft(goal ? String(goal) : '')
    setEditing(true)
  }
  const commit = () => {
    const n = Math.max(0, Math.min(1000, Math.round(Number(draft) || 0)))
    onSetGoal(n)
    setEditing(false)
  }

  const editor = (
    <div className="goal-editor">
      <label className="goal-editor-label" htmlFor="goal-input">
        Books to finish this year
      </label>
      <div className="goal-editor-row">
        <input
          id="goal-input"
          type="number"
          className="set-num"
          min={0}
          max={1000}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <button className="btn btn-primary" onClick={commit}>
          Save
        </button>
        {goal > 0 && (
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )

  // No goal yet: invite the user to set one.
  if (goal <= 0) {
    return (
      <div className="section">
        <SectionHead icon="flag" title="Reading goal" />
        <div className="chart-card goal-card" style={{ marginTop: 0 }}>
          {editing ? (
            editor
          ) : (
            <div className="goal-empty">
              <div className="goal-empty-ico">
                <Icon name="flag" />
              </div>
              <div className="goal-empty-text">
                <div className="goal-empty-title">Set a reading goal</div>
                <div className="goal-empty-sub">
                  Pick how many books you want to finish this year and track your progress.
                </div>
              </div>
              <button className="btn btn-primary" onClick={startEdit}>
                Set a goal
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const done = booksThisYear ?? 0
  const frac = goal > 0 ? done / goal : 0
  const pct = Math.round(frac * 100)
  const remaining = Math.max(0, goal - done)
  const expected = goal * yearElapsedFraction()
  const ahead = done - expected
  let pace: { text: string; tone: 'good' | 'behind' | 'done' }
  if (done >= goal) pace = { text: 'Goal reached - nice work!', tone: 'done' }
  else if (ahead >= 0.5)
    pace = { text: `${Math.round(ahead)} ahead of schedule`, tone: 'good' }
  else if (ahead <= -0.5)
    pace = { text: `${Math.round(-ahead)} behind schedule`, tone: 'behind' }
  else pace = { text: 'Right on pace', tone: 'good' }

  return (
    <div className="section">
      <SectionHead icon="flag" title="Reading goal" />
      <div className="chart-card goal-card" style={{ marginTop: 0 }}>
        {editing ? (
          editor
        ) : (
          <div className="goal-body">
            <ProgressRing
              frac={frac}
              label={booksThisYear == null ? '--' : `${pct}%`}
              sub={`of ${goal}`}
            />
            <div className="goal-meta">
              {booksThisYear == null ? (
                <>
                  <div className="goal-headline">Goal: {goal} books</div>
                  <div className="goal-sub">
                    Progress needs the library database - it isn't available on this server.
                  </div>
                </>
              ) : (
                <>
                  <div className="goal-headline">
                    {done} of {goal} books this year
                  </div>
                  <div className={'goal-pace goal-pace-' + pace.tone}>{pace.text}</div>
                  {remaining > 0 && (
                    <div className="goal-sub">
                      {remaining} to go{remaining === 1 ? '' : ''}
                    </div>
                  )}
                </>
              )}
              <button className="btn goal-edit-btn" onClick={startEdit}>
                <Icon name="edit" />
                Edit goal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Hours label for badge sub-stats: one decimal under 10h so a 1.7h book doesn't
// round to "2h"; whole hours above that ("47h").
function hoursOnly(seconds: number): string {
  const h = seconds / 3600
  return h < 10 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h)}h`
}

// Finished-book highlight badges: longest / shortest book, most-read author /
// narrator. Each card only renders when its data exists, so a fresh user with no
// finishes shows nothing rather than empty cards.
interface HighlightCard {
  key: string
  cap: string
  headline: string
  sub: string
  // A book card shows its cover; a person card shows an icon.
  book?: { itemId: string; title: string } | null
  icon?: string
}

function bookCount(n: number): string {
  return `${n} ${n === 1 ? 'book' : 'books'}`
}

function HighlightsSection({ highlights }: { highlights: HSStatsHighlights }) {
  const cards: HighlightCard[] = []
  const bookOf = (b: { title: string; libraryItemId: string | null }) =>
    b.libraryItemId ? { itemId: b.libraryItemId, title: b.title || 'Untitled' } : null

  if (highlights.longestBook)
    cards.push({
      key: 'longest',
      cap: 'Longest book finished',
      headline: highlights.longestBook.title || 'Untitled',
      sub: hoursOnly(highlights.longestBook.durationSec),
      book: bookOf(highlights.longestBook),
      icon: 'straighten',
    })
  if (highlights.shortestBook)
    cards.push({
      key: 'shortest',
      cap: 'Shortest book finished',
      headline: highlights.shortestBook.title || 'Untitled',
      sub: hoursOnly(highlights.shortestBook.durationSec),
      book: bookOf(highlights.shortestBook),
      icon: 'compress',
    })
  if (highlights.topAuthor)
    cards.push({
      key: 'author',
      cap: 'Most-read author',
      headline: highlights.topAuthor.name,
      sub: bookCount(highlights.topAuthor.count),
      icon: 'edit_note',
    })
  if (highlights.topNarrator)
    cards.push({
      key: 'narrator',
      cap: 'Most-read narrator',
      headline: highlights.topNarrator.name,
      sub: bookCount(highlights.topNarrator.count),
      icon: 'record_voice_over',
    })
  if (highlights.mostReRead)
    cards.push({
      key: 'reread',
      cap: 'Most re-read',
      headline: highlights.mostReRead.title || 'Untitled',
      sub: `${highlights.mostReRead.completions}x finished`,
      book: highlights.mostReRead.libraryItemId
        ? { itemId: highlights.mostReRead.libraryItemId, title: highlights.mostReRead.title || 'Untitled' }
        : null,
      icon: 'replay',
    })

  if (!cards.length) return null

  return (
    <div className="section">
      <SectionHead icon="workspace_premium" title="Highlights" />
      <div className="badge-grid">
        {cards.map((c) => (
          <div className="badge-card" key={c.key}>
            {c.book ? (
              <Cover
                itemId={c.book.itemId}
                title={c.book.title}
                fs={3}
                className="badge-cover"
              />
            ) : (
              <div className="badge-ico">
                <Icon name={c.icon ?? 'workspace_premium'} />
              </div>
            )}
            <div className="badge-body">
              <div className="badge-top">
                <span className="badge-cap">{c.cap}</span>
                <span className="badge-stat">{c.sub}</span>
              </div>
              <div className="badge-headline">{c.headline}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// By-month averages from the durable snapshot history. Shows average hours and
// average books per month across every month HS has snapshotted, plus a mini bar
// row of monthly hours. Only rendered when there is at least one month of history.
function MonthCard({ months }: { months: HSStatsMonth[] }) {
  if (months.length === 0) return null
  const totalHours = months.reduce((s, m) => s + m.seconds / 3600, 0)
  const totalBooks = months.reduce((s, m) => s + m.books, 0)
  const avgHours = totalHours / months.length
  const avgBooks = totalBooks / months.length
  // Last 12 months of hours, for the mini bar row.
  const recent = months.slice(-12).map((m) => ({
    label: m.month.slice(5), // 'MM'
    hours: Math.round((m.seconds / 3600) * 10) / 10,
  }))
  const max = Math.max(0.1, ...recent.map((r) => r.hours))

  return (
    <div className="chart-card" style={{ marginTop: 'var(--s6)' }}>
      <SectionHead icon="calendar_view_month" title="By month" />
      <div className="chart-sub">Averages across {months.length} {months.length === 1 ? 'month' : 'months'} of history</div>
      <div className="month-avgs">
        <div className="month-avg">
          <div className="month-avg-num">{avgHours.toFixed(1)}<u>h</u></div>
          <div className="month-avg-cap">Avg hours / month</div>
        </div>
        <div className="month-avg">
          <div className="month-avg-num">{avgBooks.toFixed(1)}</div>
          <div className="month-avg-cap">Avg books / month</div>
        </div>
      </div>
      {recent.length > 1 && (
        <div className="bars" style={{ marginTop: 'var(--s4)' }}>
          {recent.map((r, i) => (
            <div className="bar-col" key={i}>
              <span className="v">{r.hours}h</span>
              <div className="bar" style={{ height: (r.hours / max) * 100 + '%' }} />
              <span className="d">{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
