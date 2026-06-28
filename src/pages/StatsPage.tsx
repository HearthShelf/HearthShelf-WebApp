import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getListeningStats, type ListeningStats } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local time formatter (no shared util in this app). Renders e.g. "12h 30m".
function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Build a stable YYYY-MM-DD key in local time (matches ABS's byDay keys).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function StatsPage() {
  const { target } = useActiveServer()

  const { data, isLoading, isError, refetch } = useQuery<ListeningStats>({
    queryKey: ['abs-stats', target?.serverId],
    queryFn: () => getListeningStats(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Last 7 calendar days (hours), newest day last, for the weekly bar chart.
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

  // Last 26 weeks (182 days) of listening as a heatmap; opacity scales with the
  // busiest day in the window.
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
        <p className="page-sub">Loading stats...</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="page fade-in">
        <div className="empty-state">
          <Icon name="error" />
          <h3>Could not load your stats</h3>
          <button
            className="btn-sm btn-ghost"
            style={{ margin: '0 auto' }}
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const totalH = Math.floor(data.totalTimeSec / 3600)
  const totalM = Math.floor((data.totalTimeSec % 3600) / 60)
  const activeDays = Object.keys(data.byDay).filter((k) => data.byDay[k] > 0).length
  const todayMin = Math.round(data.todaySec / 60)
  const hasActivity = data.totalTimeSec > 0 || activeDays > 0

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
          {fmtDuration(data.totalTimeSec)} of audio so far
        </div>
      </div>

      <div className="stat-tiles">
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

      {!hasActivity ? (
        <div className="empty-state" style={{ marginTop: 'var(--s6)' }}>
          <Icon name="bar_chart" />
          <h3>No listening yet</h3>
          <p>Your activity will show up here as you listen.</p>
        </div>
      ) : (
        <>
          <div className="chart-card" style={{ marginTop: 'var(--s6)' }}>
            <div className="sh-day">Last 7 days</div>
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
            <div className="sh-day">Last 6 months</div>
            <div className="heatmap">
              {heat.map((c) => (
                <i
                  key={c.key}
                  title={`${c.key}: ${c.mins} min`}
                  style={
                    c.ratio > 0
                      ? {
                          background: `color-mix(in oklab, var(--accent) ${Math.round(
                            18 + c.ratio * 82
                          )}%, var(--c-highest))`,
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
