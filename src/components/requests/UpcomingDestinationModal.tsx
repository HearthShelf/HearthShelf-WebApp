import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'
import { externalLinks } from '@/lib/externalLinks'
import { useSettingsStore } from '@/store/settingsStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { getSeriesList } from '@/api/absLibrary'

export interface UpcomingTarget {
  title: string
  author?: string
  cover?: string
  asin?: string
  /** The series this belongs to, when known - used to offer the local series page. */
  seriesTitle?: string
}

/** Find the ABS series whose name matches, so we can link to the local series
 *  page. Returns null when the library has no such series (a series you follow
 *  but own nothing from), in which case that row is simply not offered. */
function useLocalSeriesId(seriesTitle: string | undefined) {
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()
  return useQuery({
    queryKey: ['series-lookup', target?.serverId, activeId, seriesTitle],
    queryFn: async () => {
      const all = await getSeriesList(target!, activeId!)
      const want = (seriesTitle ?? '').trim().toLowerCase()
      return all.find((s) => s.name.trim().toLowerCase() === want)?.id ?? null
    },
    enabled: Boolean(target) && Boolean(activeId) && Boolean(seriesTitle),
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

// Where do you want to go? A book that isn't in the library has no page of its
// own here, so rather than guessing (and dead-ending on a route that doesn't
// exist) this asks: the series page you own, or one of the external sites you've
// enabled in Settings.
export function UpcomingDestinationModal({
  item,
  onClose,
}: {
  item: UpcomingTarget
  onClose: () => void
}) {
  const navigate = useNavigate()
  const goodreads = useSettingsStore((s) => s.externalLinkGoodreads)
  const audible = useSettingsStore((s) => s.externalLinkAudible)
  const hardcover = useSettingsStore((s) => s.externalLinkHardcover)
  const { data: seriesId } = useLocalSeriesId(item.seriesTitle)

  const links = externalLinks({
    title: item.title,
    author: item.author ?? '',
    isbn: null,
    asin: item.asin ?? null,
    enabled: { goodreads, audible, hardcover },
  })

  return (
    <Modal title="Open in" onClose={onClose}>
      <div className="ud-head">
        {item.cover ? (
          <img className="ud-cover" src={item.cover} alt="" />
        ) : (
          <div className="ud-cover up-cover-ph" />
        )}
        <div className="ud-meta">
          <div className="ud-title">{item.title}</div>
          {item.author && <div className="ud-sub">{item.author}</div>}
          {item.seriesTitle && <div className="ud-series">{item.seriesTitle}</div>}
        </div>
      </div>

      <div className="ud-list">
        {item.asin && (
          <button
            className="ud-row"
            onClick={() => {
              onClose()
              navigate(`/upcoming/${encodeURIComponent(item.asin!)}`)
            }}
          >
            <Icon name="menu_book" />
            <div className="ud-row-meta">
              <b>Book details</b>
              <span>Release date, description, and narrator</span>
            </div>
            <Icon name="chevron_right" />
          </button>
        )}

        {seriesId && (
          <button
            className="ud-row"
            onClick={() => {
              onClose()
              navigate(`/series/${seriesId}`)
            }}
          >
            <Icon name="auto_awesome_motion" />
            <div className="ud-row-meta">
              <b>Series page</b>
              <span>See every book in {item.seriesTitle}</span>
            </div>
            <Icon name="chevron_right" />
          </button>
        )}

        {links.map((l) => (
          <a
            key={l.key}
            className="ud-row"
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            <Icon name={l.icon} />
            <div className="ud-row-meta">
              <b>{l.label}</b>
              <span>Open in a new tab</span>
            </div>
            <Icon name="open_in_new" />
          </a>
        ))}

        {!item.asin && !seriesId && links.length === 0 && (
          <p className="ud-none">
            No destinations are enabled. Turn on book links in Settings → Library.
          </p>
        )}
      </div>
    </Modal>
  )
}
