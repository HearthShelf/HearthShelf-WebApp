import { useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAllLibraryItemsFull } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import {
  useMonthlyShelf,
  useDiscoverFeedbackQuery,
  useSetDiscoverFeedback,
  usePopular,
} from '@/hooks/useDiscover'
import { useQgConfig, useQuestGiverEnabled } from '@/hooks/useQuestGiver'
import { useQuestGiverPicks } from '@/hooks/useQuestGiverPicks'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { SectionHead } from '@/components/common/SectionHead'
import { BookTile } from '@/components/library/BookTile'
import { QuestGiverEntry } from '@/components/questgiver/QuestGiverEntry'
import { DiscoverAiTile } from '@/components/discover/DiscoverAiTile'
import { useRatings, useSetRating } from '@/hooks/useRatings'
import { DiscoverSearch } from '@/components/discover/DiscoverSearch'
import { useIgnoredItemIds } from '@/hooks/useIgnoredItemIds'
import { buildDiscoverShelves, rankDiscoverShelves } from '@hearthshelf/core'

export function DiscoverPage() {
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()
  const progressById = useMediaProgress()
  const qgEnabled = useQuestGiverEnabled()

  // Route gate: Discover shares QuestGiver's config and is default-enabled. A
  // stale /discover link redirects home only when the backend explicitly disables
  // it (discoverEnabled === false) on the active server.
  const { data: config, isLoading: configLoading } = useQgConfig()
  const discoverEnabled = config?.discoverEnabled !== false

  const { data, isLoading } = useQuery({
    queryKey: ['discover', 'all-items', target?.serverId, activeId],
    queryFn: () => getAllLibraryItemsFull(target!, activeId as string),
    enabled: Boolean(target) && Boolean(activeId) && discoverEnabled,
  })

  const items = useMemo(() => data?.results ?? [], [data])
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])
  const ownedKeys = useMemo(
    () =>
      new Set(
        items.map((it) => {
          const m = it.media.metadata
          return ((m.title ?? '') + '|' + (m.authorName ?? '')).toLowerCase()
        }),
      ),
    [items],
  )
  // Books in series the user ignored. Ignore means "no interest", so they drop
  // out of every row here while staying in the library and in search.
  const ignoredIds = useIgnoredItemIds(discoverEnabled)
  const { shelves: baseShelves, profile } = useMemo(
    () => buildDiscoverShelves(items, progressById, ignoredIds),
    [items, progressById, ignoredIds],
  )

  const hasItems = items.length > 0
  const { data: monthly } = useMonthlyShelf(items, progressById, hasItems)
  const { data: feedback } = useDiscoverFeedbackQuery(hasItems)
  const { data: popular } = usePopular(hasItems)
  const questGiverPicks = useQuestGiverPicks(hasItems)
  const setFeedback = useSetDiscoverFeedback()
  // Ratings come from /hs/ratings, not Discover feedback - the same map the book
  // page writes, so a rating set here shows up there.
  const { data: ratings } = useRatings(hasItems)
  const setRating = useSetRating()

  const fbMap = useMemo(() => feedback ?? {}, [feedback])
  const ratingMap = useMemo(() => ratings ?? {}, [ratings])

  // Apply the shared ranking layer: QuestGiver picks lead, liked/rated items float
  // up, disliked/not-interested items drop out - the same order Home previews.
  const shelves = useMemo(
    () =>
      rankDiscoverShelves(baseShelves, byId, {
        questGiverPicks,
        feedback: fbMap,
        ratings: ratingMap,
        progressById,
        ignoredIds,
      }),
    [baseShelves, byId, questGiverPicks, fbMap, ratingMap, progressById, ignoredIds],
  )

  // AI-shelf picks resolved to owned items, with not_interested hidden. The
  // shelf is cached per month, so it can still name a book from a series
  // ignored since it was generated - drop those here too.
  const aiPicks = useMemo(() => {
    if (!monthly || monthly.engine === 'none') return []
    return monthly.picks
      .map((p) => ({ item: byId.get(p.id), reason: p.reason }))
      .filter(
        (x): x is { item: NonNullable<ReturnType<typeof byId.get>>; reason: string } =>
          Boolean(x.item) &&
          fbMap[x.item!.id]?.vote !== 'not_interested' &&
          !ignoredIds.has(x.item!.id),
      )
  }, [monthly, byId, fbMap, ignoredIds])

  // Popular-on-this-server resolved to owned items.
  const popularItems = useMemo(() => {
    if (!popular?.length) return []
    return popular
      .map((p) => byId.get(p.itemId))
      .filter((it): it is NonNullable<typeof it> => Boolean(it))
      .slice(0, 18)
  }, [popular, byId])

  if (configLoading) return <LoadingSpinner />
  if (!discoverEnabled) return <Navigate to="/" replace />
  if (isLoading) return <LoadingSpinner />

  const onVote = (itemKey: string, vote: 'like' | 'dislike' | 'not_interested' | null) =>
    setFeedback.mutate({ itemKey, vote })
  const onRate = (itemKey: string, rating: number | null) => setRating.mutate({ itemKey, rating })
  const onNotInterested = (itemKey: string) =>
    setFeedback.mutate({ itemKey, vote: 'not_interested' })

  return (
    <div className="page fade-in discover-page">
      <div className="page-head">
        <div className="eyebrow">HearthShelf</div>
        <h1 className="title-xl">Discover</h1>
        <p className="page-sub">
          Search Audible for any title, or scroll for picks tuned to your listening.
        </p>
      </div>

      {target && <DiscoverSearch target={target} ownedKeys={ownedKeys} />}

      {qgEnabled && <QuestGiverEntry totalFinished={profile.totalFin} />}

      {!hasItems ? (
        <div className="empty-state">
          <Icon name="explore" />
          <h3>Nothing to discover yet</h3>
          <p>Add books to your library and they'll start showing up here.</p>
        </div>
      ) : (
        <>
          {aiPicks.length > 0 && (
            <div className="section">
              <SectionHead
                icon="auto_awesome"
                title={monthly?.intro?.trim() ? monthly.intro : 'Your shelf this month'}
              />
              <div className="disc-ai-row">
                {aiPicks.map(({ item, reason }) => {
                  const p = progressById.get(item.id)
                  return (
                    <DiscoverAiTile
                      key={item.id}
                      item={item}
                      reason={reason}
                      progress={p?.progress ?? 0}
                      finished={p?.isFinished}
                      feedback={fbMap[item.id]}
                      rating={ratingMap[item.id]}
                      onVote={onVote}
                      onRate={onRate}
                      onNotInterested={onNotInterested}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {shelves.map((shelf) => (
            <div className="section" key={shelf.id}>
              <SectionHead icon={shelf.icon} title={shelf.label} />
              <div className="shelf-row">
                {shelf.items.map((item) => {
                  const p = progressById.get(item.id)
                  return (
                    <BookTile
                      key={item.id}
                      item={item}
                      progress={p?.progress ?? 0}
                      finished={p?.isFinished}
                    />
                  )
                })}
              </div>
            </div>
          ))}

          {popularItems.length > 0 && (
            <div className="section">
              <SectionHead icon="trending_up" title="Popular on your server" />
              <div className="shelf-row">
                {popularItems.map((item) => {
                  const p = progressById.get(item.id)
                  return (
                    <BookTile
                      key={item.id}
                      item={item}
                      progress={p?.progress ?? 0}
                      finished={p?.isFinished}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
