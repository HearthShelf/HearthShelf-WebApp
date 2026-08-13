/**
 * The library's left filter rail: one filter surface for every tab.
 *
 * Only the sections that mean something for the active tab render - progress and
 * the metadata categories are book facts, "finished series" is a series fact, and
 * the people tabs get sort only. The category groups reuse core's FILTER_GROUPS /
 * FILTER_FLAGS (the same definitions behind the mobile popover in
 * LibraryFilters.tsx), rendered as collapsible sections instead of a drill-in.
 */
import { useState } from 'react'
import type { AbsLibraryItem } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import {
  FILTER_GROUPS,
  FILTER_FLAGS,
  SORT_COMMON,
  SORT_MORE,
  type LibrarySort,
} from '@hearthshelf/core'
import type { ProgFilter } from '@/components/library/LibraryFilters'

/** Hidden = the user hid it from shelves and the queue (an ABS-id dismissal).
 *  Distinct from the roster "ignored" on series pages, which keys on Audible
 *  ASINs for books that aren't in the library at all. */
export type StatusFilter = 'all' | 'following' | 'hidden' | 'not-hidden'
export type SeriesDoneFilter = 'all' | 'finished' | 'unfinished'

export type RailTab = 'books' | 'series' | 'authors' | 'narrators'

const PROGRESS_ROWS: [ProgFilter, string][] = [
  ['in-progress', 'In progress'],
  ['finished', 'Finished'],
  ['not-started', 'Not started'],
]

const SERIES_DONE_ROWS: [SeriesDoneFilter, string][] = [
  ['finished', 'Finished'],
  ['unfinished', 'Unfinished'],
]

function RailRow({
  label,
  count,
  on,
  onClick,
}: {
  label: string
  count?: number
  on: boolean
  onClick: () => void
}) {
  return (
    <button className={'rail-row' + (on ? ' on' : '')} onClick={onClick} title={label}>
      <span className="rail-row-label">{label}</span>
      {count != null && <span className="rail-row-count">{count}</span>}
      {on && <Icon name="check" className="rail-row-check" />}
    </button>
  )
}

function RailSection({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!collapsible) {
    return (
      <div className="rail-sec">
        <div className="rail-sec-head">{title}</div>
        {children}
      </div>
    )
  }
  return (
    <div className="rail-sec">
      <button className="rail-sec-head rail-sec-toggle" onClick={() => setOpen((o) => !o)}>
        {title}
        <Icon name={open ? 'expand_less' : 'expand_more'} />
      </button>
      {open && children}
    </div>
  )
}

// A category group's values, capped until the user asks for the rest - a genre
// list can run to hundreds of entries and would bury the sections below it.
const VALUES_SHOWN = 8

function GroupSection({
  group,
  items,
  filter,
  setFilter,
}: {
  group: (typeof FILTER_GROUPS)[number]
  items: AbsLibraryItem[]
  filter: string
  setFilter: (f: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const values = group.values(items)
  if (values.length === 0) return null

  // Keep the active value visible even when it sorts below the cap.
  const activeVal = filter.startsWith(`${group.id}|`) ? filter.split('|')[1] : null
  let shown = expanded ? values : values.slice(0, VALUES_SHOWN)
  if (activeVal && !shown.includes(activeVal)) shown = [activeVal, ...shown.slice(0, VALUES_SHOWN - 1)]

  return (
    <RailSection title={group.label} collapsible defaultOpen={Boolean(activeVal)}>
      {shown.map((v) => {
        const key = `${group.id}|${v}`
        return (
          <RailRow
            key={v}
            label={v}
            on={filter === key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          />
        )
      })}
      {values.length > VALUES_SHOWN && (
        <button className="rail-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${values.length}`}
        </button>
      )}
    </RailSection>
  )
}

export interface LibraryRailProps {
  tab: RailTab
  items: AbsLibraryItem[]
  filter: string
  setFilter: (f: string) => void
  prog: ProgFilter
  setProg: (p: ProgFilter) => void
  status: StatusFilter
  setStatus: (s: StatusFilter) => void
  seriesDone: SeriesDoneFilter
  setSeriesDone: (s: SeriesDoneFilter) => void
  sort: LibrarySort
  setSort: (s: LibrarySort) => void
  desc: boolean
  toggleDesc: () => void
  /** Name|Books sort shared by the series and people tabs. */
  altSort: 'Name' | 'Books'
  setAltSort: (s: 'Name' | 'Books') => void
  onClear: () => void
  anyActive: boolean
}

export function LibraryRail({
  tab,
  items,
  filter,
  setFilter,
  prog,
  setProg,
  status,
  setStatus,
  seriesDone,
  setSeriesDone,
  sort,
  setSort,
  desc,
  toggleDesc,
  altSort,
  setAltSort,
  onClear,
  anyActive,
}: LibraryRailProps) {
  const isBooks = tab === 'books'
  const isSeries = tab === 'series'
  const isPeople = tab === 'authors' || tab === 'narrators'

  return (
    <aside className="lib-rail" aria-label="Library filters">
      <div className="rail-top">
        <span className="rail-title">
          <Icon name="filter_list" /> Filters
        </span>
        {anyActive && (
          <button className="rail-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {isBooks && (
        <RailSection title="Progress">
          {PROGRESS_ROWS.map(([id, label]) => (
            <RailRow
              key={id}
              label={label}
              on={prog === id}
              onClick={() => setProg(prog === id ? 'all' : id)}
            />
          ))}
        </RailSection>
      )}

      {isSeries && (
        <RailSection title="Reading">
          {SERIES_DONE_ROWS.map(([id, label]) => (
            <RailRow
              key={id}
              label={label}
              on={seriesDone === id}
              onClick={() => setSeriesDone(seriesDone === id ? 'all' : id)}
            />
          ))}
        </RailSection>
      )}

      {(isBooks || isSeries) && (
        <RailSection title="Status">
          {isSeries && (
            <RailRow
              label="Following"
              on={status === 'following'}
              onClick={() => setStatus(status === 'following' ? 'all' : 'following')}
            />
          )}
          <RailRow
            label="Hidden"
            on={status === 'hidden'}
            onClick={() => setStatus(status === 'hidden' ? 'all' : 'hidden')}
          />
          <RailRow
            label="Not hidden"
            on={status === 'not-hidden'}
            onClick={() => setStatus(status === 'not-hidden' ? 'all' : 'not-hidden')}
          />
        </RailSection>
      )}

      {isBooks && (
        <>
          {FILTER_GROUPS.filter((g) => g.id !== 'progress').map((g) => (
            <GroupSection
              key={g.id}
              group={g}
              items={items}
              filter={filter}
              setFilter={setFilter}
            />
          ))}
          <RailSection title="Flags">
            {FILTER_FLAGS.map(([id, label]) => (
              <RailRow
                key={id}
                label={label}
                on={filter === id}
                onClick={() => setFilter(filter === id ? 'all' : id)}
              />
            ))}
          </RailSection>
        </>
      )}

      <RailSection title="Sort" collapsible defaultOpen>
        {isBooks ? (
          <>
            {[...SORT_COMMON, ...SORT_MORE].map((s) => (
              <button
                key={s}
                className={'rail-row' + (s === sort ? ' on' : '')}
                onClick={() => (s === sort ? toggleDesc() : setSort(s))}
                title={s === sort ? 'Reverse order' : `Sort by ${s}`}
              >
                <span className="rail-row-label">{s}</span>
                {s === sort && (
                  <Icon name={desc ? 'arrow_downward' : 'arrow_upward'} className="rail-row-check" />
                )}
              </button>
            ))}
          </>
        ) : (
          (['Name', 'Books'] as const).map((s) => (
            <RailRow
              key={s}
              label={s}
              on={altSort === s}
              onClick={() => setAltSort(s)}
            />
          ))
        )}
      </RailSection>

      {isPeople && (
        <p className="rail-note">
          Filters apply to the Books and Series tabs.
        </p>
      )}
    </aside>
  )
}
