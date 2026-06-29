import { useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAllLibraryItemsFull } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import {
  useDiscoverConfig,
  useMonthlyShelf,
  useDiscoverFeedbackQuery,
  usePopular,
} from '@/hooks/useDiscover'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { BookTile } from '@/components/library/BookTile'
import { buildDiscoverShelves } from '@/lib/discover'

// Heads every section: icon + title (matches the design's section-head markup).
function SectionHead({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="section-head">
      <Icon name={icon} />
      <h2>{title}</h2>
    </div>
  )
}

export function DiscoverPage() {
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()
  const progressById = useMediaProgress()

  // Route gate: Discover is admin-gated. A stale /discover link redirects home
  // when the feature is off on the active server.
  const { data: config, isLoading: configLoading } = useDiscoverConfig()

  const { data, isLoading } = useQuery({
    queryKey: ['discover', 'all-items', target?.serverId, activeId],
    queryFn: () => getAllLibraryItemsFull(target!, activeId as string),
    enabled: Boolean(target) && Boolean(activeId) && config?.enabled === true,
  })

  const items = useMemo(() => data?.results ?? [], [data])
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])
  const { shelves } = useMemo(
    () => buildDiscoverShelves(items, progressById),
    [items, progressById]
  )

  const hasItems = items.length > 0
  const { data: monthly } = useMonthlyShelf(items, progressById, hasItems)
  const { data: feedback } = useDiscoverFeedbackQuery(hasItems)
  const { data: popular } = usePopular(hasItems)

  const fbMap = feedback ?? {}

  // AI-shelf picks resolved to owned items, with not_interested hidden.
  const aiPicks = useMemo(() => {
    if (!monthly || monthly.engine === 'none') return []
    return monthly.picks
      .map((p) => ({ item: byId.get(p.id), reason: p.reason }))
      .filter(
        (x): x is { item: NonNullable<ReturnType<typeof byId.get>>; reason: string } =>
          Boolean(x.item) && fbMap[x.item!.id]?.vote !== 'not_interested'
      )
  }, [monthly, byId, fbMap])

  // Popular-on-this-server resolved to owned items.
  const popularItems = useMemo(() => {
    if (!popular?.length) return []
    return popular
      .map((p) => byId.get(p.itemId))
      .filter((it): it is NonNullable<typeof it> => Boolean(it))
      .slice(0, 18)
  }, [popular, byId])

  if (configLoading) return <LoadingSpinner />
  if (!config?.enabled) return <Navigate to="/" replace />
  if (isLoading) return <LoadingSpinner />

  return (
    <div className="page fade-in discover-page">
      <div className="page-head">
        <div className="eyebrow">HearthShelf</div>
        <h1 className="title-xl">Discover</h1>
        <p className="page-sub">Picks tuned to your listening, drawn from your library.</p>
      </div>

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
              <div className="shelf-row">
                {aiPicks.map(({ item }) => {
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
