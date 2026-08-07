import { useState, useEffect, useMemo, Fragment, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useUser } from '@clerk/clerk-react'
import {
  continueSeriesShelf,
  buildDiscoverShelves,
  rankDiscoverShelves,
  isGeneratedRecShelf,
  GENERAL_REC_SECTIONS,
  type HomeSectionId,
  type DiscoverShelf,
} from '@hearthshelf/core'
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
import { HomeSectionsEditor } from '@/components/home/HomeSectionsEditor'
import { HomeClubShelf } from '@/components/home/HomeClubShelf'
import { ReleaseCountdownBanner } from '@/components/home/ReleaseCountdownBanner'
import { DashboardRow } from '@/components/home/DashboardRow'
import { useDiscoverEnabled } from '@/hooks/useQuestGiver'
import { useMonthlyShelf, useDiscoverFeedbackQuery } from '@/hooks/useDiscover'
import { useQuestGiverPicks } from '@/hooks/useQuestGiverPicks'
import {
  getSeries,
  getAllLibraryItemsFull,
  type AbsTarget,
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

// ABS personalized shelves we suppress on Home: its recommendation +
// finished-again rows, which the HearthShelf taste engine replaces ("discover"
// also mixes in other users' books). The kept rows - continue-listening,
// continue-series, recently-added - are the user's own progress / library, not
// cross-user recommendations.
//
// Display order is no longer fixed here: the user's homeSections arrangement
// supplies it, so kept shelves are looked up by section rather than ranked.
const TAINTED_ABS_SHELVES = new Set(['discover', 'listen-again', 'read-again'])

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
  // The user's arrangement drives which bands render and in what order.
  const homeSections = useSettingsStore((s) => s.homeSections)
  const recShelfCount = useSettingsStore((s) => s.homeRecShelfCount)
  // Arrange mode replaces the shelves with draggable section rows (covers off).
  const [editing, setEditing] = useState(false)
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

  // HearthShelf's own taste engine feeds Home's recommendation bands - our
  // recommendations, not ABS's cross-library "discover" feed (which surfaces
  // other household members' books).
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

  // Taste-engine rows keyed by the Home section they belong to, so the
  // arrangement walk can render a whole section's shelves at its chosen spot.
  // Fixed-id shelves ('recommended', 'series-next', 'recent', 'questgiver') each
  // get their own arrangeable section; the taste-derived rows (genre / author /
  // narrator / cold) share the 'recommended-picks' block and are capped by
  // homeRecShelfCount, so the listener decides how much of Home the engine fills.
  const recBySection = useMemo(() => {
    const map = new Map<HomeSectionId, DiscoverShelf[]>()
    if (!discoverEnabled || !hasLib) return map
    const { shelves } = buildDiscoverShelves(libItems, progressById)
    const ranked = rankDiscoverShelves(shelves, libById, {
      questGiverPicks,
      feedback: feedback ?? {},
      progressById,
    })
    let generated = 0
    for (const s of ranked) {
      if (isGeneratedRecShelf(s.id)) {
        if (generated >= recShelfCount) continue
        generated++
      }
      const section = (GENERAL_REC_SECTIONS[s.id] ?? 'recommended-picks') as HomeSectionId
      const arr = map.get(section)
      if (arr) arr.push(s)
      else map.set(section, [s])
    }
    return map
  }, [
    discoverEnabled,
    hasLib,
    libItems,
    progressById,
    libById,
    questGiverPicks,
    feedback,
    recShelfCount,
  ])

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

  // ABS shelves we keep, indexed by the Home section id they render as. Order
  // comes from the arrangement now, not a fixed rank - so this is a lookup, not
  // a sorted list. Dropped: empty shelves, ABS's recommendation rows (our taste
  // engine replaces them), and ABS's own continue-series (we build our own above,
  // with real series ids). Applied after the unified merge so both branches are
  // filtered alike.
  const absBySection = new Map<HomeSectionId, HomeShelf[]>()
  for (const sh of rawShelves) {
    if (TAINTED_ABS_SHELVES.has(sh.id) || sh.id === 'continue-series') continue
    if (sh.type === 'series' ? sh.series.length === 0 : sh.items.length === 0) continue
    // continue-listening has its own section; every other kept ABS row
    // (recently-added, recent-series) travels with the Recently Added band.
    const section: HomeSectionId =
      sh.id === 'continue-listening' ? 'continue-listening' : 'recently-added'
    const arr = absBySection.get(section)
    if (arr) arr.push(sh)
    else absBySection.set(section, [sh])
  }

  // The taste-engine rows count as content, so a library with only suppressed
  // ABS shelves still isn't "quiet".
  const hasAnyContent =
    absBySection.size > 0 ||
    inProgress.length > 0 ||
    continueSeries.length > 0 ||
    recBySection.size > 0 ||
    Boolean(aiPreview)

  // Dashboard / countdown / clubs each fetch their own data and self-hide, so
  // we can't know here whether they'll render. Any of them being switched on is
  // enough to suppress the "quiet library" line - otherwise a reader with an
  // empty library but an active club would get told nothing is here, directly
  // above their club shelf.
  const selfFetchingOn = homeSections.some(
    (s) => s.on && (s.id === 'dashboard' || s.id === 'release-countdown' || s.id === 'book-club'),
  )
  const nothing = !isLoading && !isError && !hasAnyContent && !selfFetchingOn
  const allSectionsHidden = hasAnyContent && homeSections.every((s) => !s.on)

  // A plain taste-engine tile, shared by every recommendation band.
  const renderTile = (item: AbsLibraryItem) => {
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
  }

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
        {!isMobile && !editing && (
          <div className="hero-switch">
            <button
              className="pill"
              onClick={() => setEditing(true)}
              title="Arrange the sections on your home screen"
            >
              <Icon name="edit" /> Arrange
            </button>
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

      {isLoading && <LoadingSpinner className="py-12" label="Loading shelves..." />}
      {isError && <ErrorState message="Could not load your shelves." onRetry={refetch} />}

      {nothing && (
        <div className="sg-empty">
          <Icon name="auto_stories" />
          <p>Your library is quiet for now. Start a book to see it here.</p>
        </div>
      )}

      {editing ? (
        <HomeSectionsEditor onDone={() => setEditing(false)} />
      ) : allSectionsHidden ? (
        // The user hid every band. Say so plainly, with a way straight back to
        // arrange mode, so a bare Home reads as a choice and not a failure.
        <div className="sg-empty">
          <Icon name="visibility_off" />
          <p>Your home screen is empty because all of its sections are turned off.</p>
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            <Icon name="edit" /> Arrange your home
          </button>
        </div>
      ) : (
        // Render the bands in the order the user arranged, skipping hidden ones.
        homeSections.map((sec) => {
          if (!sec.on) return null
          switch (sec.id) {
            case 'dashboard':
              return <DashboardRow key={sec.id} />

            case 'release-countdown':
              return <ReleaseCountdownBanner key={sec.id} />

            case 'book-club':
              return <HomeClubShelf key={sec.id} />

            // The monthly AI shelf rides with the QuestGiver band - both are the
            // "picked for you by name" flavour of recommendation.
            case 'questgiver':
              return (
                <div key={sec.id}>
                  {aiPreview && (
                    <ShelfSection icon="auto_awesome" title={aiPreview.intro}>
                      {aiPreview.items.map(renderTile)}
                    </ShelfSection>
                  )}
                  {(recBySection.get('questgiver') ?? []).map((shelf) => (
                    <ShelfSection
                      key={shelf.id}
                      icon={shelf.icon}
                      title={shelf.label}
                      onMore={() => navigate('/discover')}
                    >
                      {shelf.items.map(renderTile)}
                    </ShelfSection>
                  ))}
                </div>
              )

            case 'continue-series':
              // Built from core, so each tile carries a real series id - which
              // the "Hide this series" action needs.
              if (continueSeries.length === 0) return null
              return (
                <ShelfSection
                  key={sec.id}
                  icon={SHELF_ICONS['continue-series'] ?? 'auto_stories'}
                  title="Continue Series"
                >
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
                </ShelfSection>
              )

            case 'continue-listening':
            case 'recently-added':
              return (
                <div key={sec.id}>
                  {(absBySection.get(sec.id) ?? []).map((sh) => (
                    <AbsShelfSection
                      key={sh.id}
                      shelf={sh}
                      target={target}
                      compact={compact}
                      progressById={progressById}
                      dismissedItemSet={dismissedItemSet}
                      onToast={show}
                    />
                  ))}
                </div>
              )

            // Every remaining section is a taste-engine band: one shelf for the
            // fixed-id ones, and the whole capped set for 'recommended-picks'.
            default:
              return (
                <div key={sec.id}>
                  {(recBySection.get(sec.id) ?? []).map((shelf) => (
                    <ShelfSection
                      key={shelf.id}
                      icon={shelf.icon}
                      title={shelf.label}
                      onMore={() => navigate('/discover')}
                    >
                      {shelf.items.map(renderTile)}
                    </ShelfSection>
                  ))}
                </div>
              )
          }
        })
      )}

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}

// A titled row of book tiles - the shape every Home band shares.
function ShelfSection({
  icon,
  title,
  onMore,
  children,
}: {
  icon?: string
  title: string
  onMore?: () => void
  children: ReactNode
}) {
  return (
    <div className="section">
      <SectionHead icon={icon} title={title} onMore={onMore} />
      <div className="shelf-row">{children}</div>
    </div>
  )
}

// One kept ABS shelf. Continue-Listening tiles get the dismiss + reset menu;
// series shelves render as a card grid instead of a tile row.
function AbsShelfSection({
  shelf,
  target,
  compact,
  progressById,
  dismissedItemSet,
  onToast,
}: {
  shelf: HomeShelf
  target: AbsTarget
  compact: boolean
  progressById: Map<string, MediaProgress>
  dismissedItemSet: Set<string>
  onToast: (msg: string) => void
}) {
  const isContinueListening = shelf.id === 'continue-listening'

  if (shelf.type === 'series') {
    return (
      <div className="section">
        <SectionHead icon={SHELF_ICONS[shelf.id] ?? 'library_books'} title={shelf.label} />
        <div className="series-grid">
          {shelf.series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <ShelfSection icon={SHELF_ICONS[shelf.id] ?? 'library_books'} title={shelf.label}>
      {shelf.items
        .filter((item) => !(isContinueListening && dismissedItemSet.has(item.id)))
        .map((item) => {
          const p = progressById.get(item.id)
          const tile = (
            <BookTile
              item={item}
              progress={p?.progress ?? 0}
              finished={p?.isFinished}
              fs={compact ? 12 : 15}
              compact={compact}
              onToast={onToast}
            />
          )
          // Only Continue-Listening tiles get the dismiss + reset menu; the
          // rest render bare so the row's flex layout stays untouched.
          if (!isContinueListening) return <Fragment key={item.id}>{tile}</Fragment>
          return (
            <BookContextMenu
              key={item.id}
              item={item}
              target={target}
              progress={p?.progress ?? 0}
              finished={p?.isFinished}
              source="listening"
              onToast={onToast}
            >
              {tile}
            </BookContextMenu>
          )
        })}
    </ShelfSection>
  )
}
