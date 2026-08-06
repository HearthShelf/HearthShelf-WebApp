import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useUser } from '@clerk/clerk-react'
import { continueSeriesShelf, buildDiscoverShelves, discoverHomePreview } from '@hearthshelf/core'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useHomeShelves, useItemsInProgress } from '@/hooks/useLibrary'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useSettingsStore } from '@/store/settingsStore'
import { useDismissalsStore } from '@/store/dismissalsStore'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { SectionHead } from '@/components/common/SectionHead'
import { BookTile } from '@/components/library/BookTile'
import { BookContextMenu } from '@/components/library/BookContextMenu'
import { SeriesCard } from '@/components/library/SeriesCard'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import { useToast } from '@/hooks/useToast'
import { useDiscoverEnabled } from '@/hooks/useQuestGiver'
import { useMonthlyShelf, useDiscoverFeedbackQuery } from '@/hooks/useDiscover'
import { useQuestGiverPicks } from '@/hooks/useQuestGiverPicks'
import {
  getSeries,
  getAllLibraryItemsFull,
  type AbsLibraryItem,
  type MediaProgress,
} from '@/api/absLibrary'
import { getHomeShelves, getItemsInProgress, mergeHomeShelves, type HomeShelf } from '@/api/absHome'

const SHELF_ICONS: Record<string, string> = {
  'recently-added': 'schedule',
  'recent-series': 'auto_stories',
  'continue-series': 'auto_stories',
  discover: 'explore',
  'continue-listening': 'play_circle',
}

// Display order for the ABS shelves we keep on Home (progress + library rows).
// Recommendation shelves are dropped (TAINTED_ABS_SHELVES) and replaced by the
// taste engine. Any kept shelf id not listed falls to the end in original order.
const SHELF_ORDER = ['continue-listening', 'continue-series', 'recently-added', 'recent-series']

// ABS personalized shelves we suppress on Home: its recommendation +
// finished-again rows, which the HearthShelf taste engine replaces ("discover"
// also mixes in other users' books). The kept rows - continue-listening,
// continue-series, recently-added - are the user's own progress / library, not
// cross-user recommendations.
const TAINTED_ABS_SHELVES = new Set(['discover', 'listen-again', 'read-again'])

function shelfRank(id: string): number {
  const i = SHELF_ORDER.indexOf(id)
  return i === -1 ? SHELF_ORDER.length : i
}

function greetingWord(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

type HeroStyle = 'comfy' | 'compact'

const HERO_KEY = 'hearthshelf:heroStyle'

interface HeroProps {
  book: AbsLibraryItem
  progress?: MediaProgress
}

// Big "jump back in" card for the first in-progress item (Comfy hero).
function ResumeHero({ book, progress }: HeroProps) {
  const ui = useMediaUI()
  const md = book.media.metadata
  const title = md.title ?? 'Untitled'
  const pct = progress?.progress ?? 0
  const hours = book.media.duration ? Math.round(book.media.duration / 360) / 10 : 0
  const chapters = book.media.numChapters ?? 0
  const open = () => ui.openItem(book.id)

  return (
    <div data-cv={tintFor(title)} className="hero-resume-card">
      <Cover
        itemId={book.id}
        title={title}
        author={md.authorName || undefined}
        fs={20}
        onClick={open}
        style={{
          width: 220,
          height: 220,
          flex: 'none',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lift)',
          cursor: 'pointer',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Jump back in
        </div>
        <h2
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: '0 0 8px',
          }}
        >
          {title}
        </h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14.5, marginBottom: 14 }}>
          {md.authorName}
          {md.narratorName && ` · Narrated by ${md.narratorName}`}
        </div>
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 13,
            marginBottom: 18,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {hours > 0 && `${hours}h`}
          {chapters > 0 && ` · ${chapters} chapters`}
          {pct > 0 && ` · ${Math.round(pct * 100)}% complete`}
        </div>
        <div className="prog-line" style={{ maxWidth: 460, marginBottom: 22 }}>
          <i style={{ width: Math.min(100, pct * 100) + '%' }} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-primary"
            onClick={() => ui.playItem(book.id, { openPlayer: true })}
          >
            <Icon name="play_arrow" fill /> {pct > 0 ? 'Resume' : 'Start listening'}
          </button>
          <button className="pill" onClick={open}>
            <Icon name="info" /> Details
          </button>
        </div>
      </div>
    </div>
  )
}

// Compact inline "jump back in" strip (Compact hero / mobile).
function CalmHero({ book, progress }: HeroProps) {
  const ui = useMediaUI()
  const title = book.media.metadata.title ?? 'Untitled'
  const pct = progress?.progress ?? 0

  return (
    <div
      className="hero-calm"
      data-cv={tintFor(title)}
      onClick={() => ui.playItem(book.id, { openPlayer: true })}
    >
      <Cover
        itemId={book.id}
        title={title}
        fs={6}
        onClick={(e) => {
          e.stopPropagation()
          ui.openItem(book.id)
        }}
        style={{ width: 76, height: 76, borderRadius: 12, flex: 'none', cursor: 'pointer' }}
      />
      <div className="hc-meta">
        <div className="hc-k">Jump back in</div>
        <div className="hc-t">{title}</div>
        <div className="prog-line" style={{ maxWidth: 360 }}>
          <i style={{ width: Math.min(100, pct * 100) + '%' }} />
        </div>
      </div>
      <button
        className="hc-play"
        onClick={(e) => {
          e.stopPropagation()
          ui.playItem(book.id, { openPlayer: true })
        }}
      >
        <Icon name="play_arrow" fill />
      </button>
    </div>
  )
}

export function HomePage() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const { active, activeId, libraries } = useActiveLibrary()
  const isMobile = useIsMobile()
  const { toast, show } = useToast()

  const unifiedPref = useSettingsStore((s) => s.unifiedHome)
  const setSetting = useSettingsStore((s) => s.set)
  // Unified home only does something with more than one library; below that it
  // is the same single-library Home, so we never branch on it.
  const unified = unifiedPref && libraries.length > 1

  const [heroStyle, setHeroStyle] = useState<HeroStyle>(
    () => (localStorage.getItem(HERO_KEY) as HeroStyle) || 'comfy',
  )
  const chooseHero = (h: HeroStyle) => {
    setHeroStyle(h)
    localStorage.setItem(HERO_KEY, h)
  }
  // Mobile is always compact - the Comfy hero and the toggle are desktop-only.
  const compact = isMobile || heroStyle === 'compact'

  // The page renders inside <ActiveServerMediaUI>, so target is connected by the
  // time we render. Guard defensively anyway.
  const safeTarget = target ?? { serverId: '', serverUrl: '' }
  const enabled = Boolean(target) && Boolean(activeId)

  // --- single-library reads (used when unified is off) ---------------------
  const single = useHomeShelves(safeTarget, activeId ?? undefined, enabled && !unified)
  const { data: singleInProgress } = useItemsInProgress(
    safeTarget,
    activeId ?? undefined,
    enabled && !unified,
  )

  // --- unified reads: fan out one home-shelves query per library -----------
  // /api/me/items-in-progress is already server-wide, so the unified in-progress
  // is just that same call with no library filter. The shelves are per-library,
  // so we fetch each library's shelves and merge them by shelf id.
  const unifiedQueryOptions: UseQueryOptions<AbsLibraryItem[] | HomeShelf[]>[] = unified
    ? [
        {
          queryKey: ['abs-items-in-progress', target?.serverId, '__all__'],
          queryFn: () => getItemsInProgress(safeTarget),
          staleTime: 30 * 1000,
        },
        ...libraries.map((lib) => ({
          queryKey: ['abs-home-shelves', target?.serverId, lib.id],
          queryFn: () => getHomeShelves(safeTarget, lib.id),
          staleTime: 60 * 1000,
        })),
      ]
    : []
  const unifiedQueries = useQueries({ queries: unifiedQueryOptions })
  const unifiedInProgressQuery = unified ? unifiedQueries[0] : undefined
  const unifiedShelfQueries = unified ? unifiedQueries.slice(1) : []

  const progressById = useMediaProgress()

  // Dismissals hide series/books from the Continue-* shelves (and the queue).
  const hydrateDismissals = useDismissalsStore((s) => s.hydrate)
  const dismissedSeries = useDismissalsStore((s) => s.seriesIds)
  const dismissedItems = useDismissalsStore((s) => s.itemIds)
  useEffect(() => {
    if (target) void hydrateDismissals(target)
  }, [target, hydrateDismissals])
  const dismissedItemSet = useMemo(() => new Set(dismissedItems), [dismissedItems])

  // Continue-Series is built from @hearthshelf/core (real series ids per tile),
  // off the /series endpoint - the missing shelf the hosted app never showed.
  const { data: seriesData } = useQuery({
    queryKey: ['home-series', target?.serverId ?? '', activeId ?? ''],
    queryFn: () => getSeries(safeTarget, activeId as string),
    enabled: Boolean(target) && Boolean(activeId),
    staleTime: 2 * 60 * 1000,
  })
  const continueSeries = useMemo(() => {
    const all = seriesData?.results ?? []
    if (!all.length) return []
    return continueSeriesShelf(all, progressById, {
      seriesIds: dismissedSeries,
      itemIds: dismissedItems,
    })
  }, [seriesData, progressById, dismissedSeries, dismissedItems])

  // HearthShelf's own taste engine feeds the Home discovery preview - our
  // recommendations, not ABS's cross-library "discover" feed (which surfaces
  // other household members' books). Home shows a single lead shelf; the full
  // set lives on the Discover page.
  const discoverEnabled = useDiscoverEnabled()
  const { data: libraryData } = useQuery({
    queryKey: ['discover', 'all-items', target?.serverId, activeId],
    queryFn: () => getAllLibraryItemsFull(safeTarget, activeId as string),
    enabled: Boolean(target) && Boolean(activeId) && discoverEnabled,
    staleTime: 5 * 60 * 1000,
  })
  const libItems = useMemo(() => libraryData?.results ?? [], [libraryData])
  const libById = useMemo(() => new Map(libItems.map((it) => [it.id, it])), [libItems])
  const hasLib = libItems.length > 0
  const questGiverPicks = useQuestGiverPicks(discoverEnabled && hasLib)
  const { data: feedback } = useDiscoverFeedbackQuery(discoverEnabled && hasLib)
  const { data: monthly } = useMonthlyShelf(libItems, progressById, discoverEnabled && hasLib)

  const previewShelf = useMemo(() => {
    if (!discoverEnabled || !hasLib) return null
    const { shelves } = buildDiscoverShelves(libItems, progressById)
    return discoverHomePreview(shelves, libById, {
      questGiverPicks,
      feedback: feedback ?? {},
    })
  }, [discoverEnabled, hasLib, libItems, progressById, libById, questGiverPicks, feedback])

  // The monthly AI shelf resolved to owned items, not-interested filtered out.
  const aiPreview = useMemo(() => {
    if (!discoverEnabled || !monthly || monthly.engine === 'none') return null
    const fb = feedback ?? {}
    const items = monthly.picks
      .map((p) => libById.get(p.id))
      .filter((it): it is AbsLibraryItem => Boolean(it) && fb[it!.id]?.vote !== 'not_interested')
      .slice(0, 12)
    if (items.length === 0) return null
    return { intro: monthly.intro?.trim() || 'Your shelf this month', items }
  }, [discoverEnabled, monthly, libById, feedback])

  if (!target) return null

  const name = user?.firstName || user?.username || 'there'

  // Resolve shelves + in-progress + load state from whichever branch is active.
  const inProgress: AbsLibraryItem[] = unified
    ? ((unifiedInProgressQuery?.data as AbsLibraryItem[] | undefined) ?? [])
    : (singleInProgress ?? [])

  const rawShelves: HomeShelf[] = unified
    ? mergeHomeShelves(unifiedShelfQueries.map((q) => (q.data as HomeShelf[] | undefined) ?? []))
    : (single.data ?? [])

  const isLoading = unified ? unifiedQueries.some((q) => q.isLoading) : single.isLoading
  const isError = unified ? unifiedQueries.some((q) => q.isError) : single.isError
  const refetch = () => {
    if (unified) unifiedQueries.forEach((q) => void q.refetch())
    else void single.refetch()
  }

  const hero = inProgress[0]
  const heroProgress = hero ? progressById.get(hero.id) : undefined
  const heroPct = heroProgress?.progress ?? 0

  // Shelves we render: book + series shelves, in display order, dropping the
  // empty ones, ABS's recommendation rows (our taste engine replaces them), and
  // ABS's own continue-series (we build our own above, with real series ids).
  // Applied after the unified merge so both branches are filtered alike.
  const ordered: HomeShelf[] = rawShelves
    .filter(
      (sh) =>
        !TAINTED_ABS_SHELVES.has(sh.id) &&
        sh.id !== 'continue-series' &&
        (sh.type === 'series' ? sh.series.length > 0 : sh.items.length > 0),
    )
    .sort((a, b) => shelfRank(a.id) - shelfRank(b.id))

  // The taste-engine rows count as content, so a library with only suppressed
  // ABS shelves still isn't "quiet".
  const nothing =
    !isLoading &&
    !isError &&
    ordered.length === 0 &&
    inProgress.length === 0 &&
    !previewShelf &&
    !aiPreview

  return (
    <div className={'page fade-in' + (compact ? ' home-compact' : '')}>
      <div className="home-head-row">
        <div>
          <div className="eyebrow">HearthShelf</div>
          <h1 className="title-xl">
            {greetingWord()}, {name}
          </h1>
          {hero ? (
            <p className="page-sub">
              You're {Math.round(heroPct * 100)}% through{' '}
              <b style={{ color: 'var(--text)' }}>{hero.media.metadata.title}</b> ·{' '}
              {inProgress.length} {inProgress.length === 1 ? 'book' : 'books'} on the go
              {unified ? (
                <>
                  {' '}
                  <Icon name="hub" /> across all libraries
                </>
              ) : (
                active && ` in ${active.name}`
              )}
            </p>
          ) : (
            <p className="page-sub">Nothing in progress yet</p>
          )}
        </div>
        {!isMobile && (
          <div className="hero-switch">
            {libraries.length > 1 && (
              <button
                className={'pill' + (unifiedPref ? ' on' : '')}
                onClick={() => setSetting('unifiedHome', !unifiedPref)}
                title="Show Home across every library at once"
              >
                <Icon name="hub" /> All libraries
              </button>
            )}
            <div className="seg">
              <button
                className={heroStyle === 'comfy' ? 'on' : ''}
                onClick={() => chooseHero('comfy')}
              >
                Comfy
              </button>
              <button
                className={heroStyle === 'compact' ? 'on' : ''}
                onClick={() => chooseHero('compact')}
              >
                Compact
              </button>
            </div>
          </div>
        )}
      </div>

      {hero && !compact && <ResumeHero book={hero} progress={heroProgress} />}
      {hero && compact && <CalmHero book={hero} progress={heroProgress} />}

      {aiPreview && (
        <div className="section">
          <SectionHead icon="auto_awesome" title={aiPreview.intro} />
          <div className="shelf-row">
            {aiPreview.items.map((item) => {
              const p = progressById.get(item.id)
              return (
                <BookTile
                  key={item.id}
                  item={item}
                  progress={p?.progress ?? 0}
                  finished={p?.isFinished}
                  fs={compact ? 12 : 15}
                  compact={compact}
                  onToast={show}
                />
              )
            })}
          </div>
        </div>
      )}

      {previewShelf && (
        <div className="section">
          <SectionHead
            icon={previewShelf.icon}
            title={previewShelf.label}
            onMore={() => navigate('/discover')}
          />
          <div className="shelf-row">
            {previewShelf.items.map((item) => {
              const p = progressById.get(item.id)
              return (
                <BookTile
                  key={item.id}
                  item={item}
                  progress={p?.progress ?? 0}
                  finished={p?.isFinished}
                  fs={compact ? 12 : 15}
                  compact={compact}
                  onToast={show}
                />
              )
            })}
          </div>
        </div>
      )}

      {isLoading && <LoadingSpinner className="py-12" label="Loading shelves..." />}
      {isError && <ErrorState message="Could not load your shelves." onRetry={refetch} />}

      {nothing && (
        <div className="sg-empty">
          <Icon name="auto_stories" />
          <p>Your library is quiet for now. Start a book to see it here.</p>
        </div>
      )}

      {/* Continue Series (built from core, real series ids for dismissal). */}
      {continueSeries.length > 0 && (
        <div className="section">
          <SectionHead
            icon={SHELF_ICONS['continue-series'] ?? 'auto_stories'}
            title="Continue Series"
          />
          <div className="shelf-row">
            {continueSeries.map(({ series, nextBook }) => {
              const p = progressById.get(nextBook.id)
              return (
                <BookContextMenu
                  key={nextBook.id}
                  item={nextBook}
                  target={target}
                  progress={p?.progress ?? 0}
                  finished={p?.isFinished}
                  source="series"
                  seriesId={series.id}
                  seriesName={series.name}
                  onToast={show}
                >
                  <BookTile
                    item={nextBook}
                    progress={p?.progress ?? 0}
                    finished={p?.isFinished}
                    fs={compact ? 12 : 15}
                    compact={compact}
                    onToast={show}
                  />
                </BookContextMenu>
              )
            })}
          </div>
        </div>
      )}

      {ordered.map((sh) => {
        const isContinueListening = sh.id === 'continue-listening'
        return (
          <div className="section" key={sh.id}>
            <SectionHead icon={SHELF_ICONS[sh.id] ?? 'library_books'} title={sh.label} />
            {sh.type === 'series' ? (
              <div className="series-grid">
                {sh.series.map((s) => (
                  <SeriesCard key={s.id} series={s} />
                ))}
              </div>
            ) : (
              <div className="shelf-row">
                {sh.items
                  .filter((item) => !(isContinueListening && dismissedItemSet.has(item.id)))
                  .map((item) => {
                    const p = progressById.get(item.id)
                    // Continue-Listening tiles get the dismiss + reset menu.
                    if (isContinueListening) {
                      return (
                        <BookContextMenu
                          key={item.id}
                          item={item}
                          target={target}
                          progress={p?.progress ?? 0}
                          finished={p?.isFinished}
                          source="listening"
                          onToast={show}
                        >
                          <BookTile
                            item={item}
                            progress={p?.progress ?? 0}
                            finished={p?.isFinished}
                            fs={compact ? 12 : 15}
                            compact={compact}
                            onToast={show}
                          />
                        </BookContextMenu>
                      )
                    }
                    return (
                      <BookTile
                        key={item.id}
                        item={item}
                        progress={p?.progress ?? 0}
                        finished={p?.isFinished}
                        fs={compact ? 12 : 15}
                        compact={compact}
                        onToast={show}
                      />
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
