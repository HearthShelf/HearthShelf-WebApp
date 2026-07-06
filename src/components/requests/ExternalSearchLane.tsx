import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { searchAudible, audibleKeys, audibleStoreUrl } from '@/api/absAudible'
import { useRmabEnabled } from '@/hooks/useRmab'
import { useSettingsStore } from '@/store/settingsStore'
import { RequestConfirmModal } from '@/components/requests/RequestConfirmModal'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSAudibleSearchResult } from '@hearthshelf/core'

interface ExternalSearchLaneProps {
  target: AbsTarget
  query: string
  // Owned-title keys ("title|author", lowercased) to dedupe against the library.
  ownedKeys: Set<string>
}

// One catalog result card. Opens the request/buy modal on click when the request
// backend is connected; otherwise its action is a plain buy-on-Audible link.
function ResultTile({
  result,
  canRequest,
  onOpen,
}: {
  result: HSAudibleSearchResult
  canRequest: boolean
  onOpen: (r: HSAudibleSearchResult) => void
}) {
  const hours = result.durationMinutes ? Math.round(result.durationMinutes / 60) : null
  return (
    <div className="req-tile" onClick={canRequest ? () => onOpen(result) : undefined}>
      {result.coverArtUrl ? (
        <img className="cover" src={result.coverArtUrl} alt="" />
      ) : (
        <div className="cover" style={{ background: 'var(--c-highest)' }} />
      )}
      <div className="rt-body">
        <div className="rt-title">{result.title}</div>
        <div className="rt-author">
          {result.author}
          {result.narrator ? ' · ' + result.narrator : ''}
        </div>
        <div className="rt-chips">
          {result.series && (
            <span className="rt-chip">
              <Icon name="bookmark" /> {result.series}
            </span>
          )}
          {hours != null && (
            <span className="rt-chip">
              <Icon name="schedule" /> {hours}h
            </span>
          )}
          {result.rating != null && (
            <span className="rt-chip">
              <Icon name="star" fill /> {result.rating}
            </span>
          )}
        </div>
        <div className="rt-action">
          {canRequest ? (
            <button className="req-btn" onClick={() => onOpen(result)}>
              <Icon name="add" /> Request
            </button>
          ) : (
            <a
              className="req-btn ghost"
              href={audibleStoreUrl(result)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="open_in_new" /> Buy on Audible
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// "Not in your library" lane. Searches the Audible catalog (HearthShelf's own
// lookup, so it works whether or not the request backend is connected) and shows
// titles you don't own. Gated by the searchExternalSources setting; fails soft.
export function ExternalSearchLane({ target, query, ownedKeys }: ExternalSearchLaneProps) {
  const externalOn = useSettingsStore((s) => s.searchExternalSources)
  const canRequest = useRmabEnabled()
  const [confirm, setConfirm] = useState<HSAudibleSearchResult | null>(null)
  const q = query.trim()
  const enabled = externalOn && q.length >= 2

  const { data } = useQuery({
    queryKey: audibleKeys.search(q),
    queryFn: () => searchAudible(target, q),
    enabled,
    staleTime: 60 * 1000,
    retry: false,
  })

  if (!enabled) return null

  const results = (data?.results ?? []).filter(
    (r) => !ownedKeys.has((r.title + '|' + r.author).toLowerCase()),
  )
  if (results.length === 0) return null

  return (
    <div className="rmab-lane">
      <div className="rmab-lane-head">
        <Icon name="travel_explore" />
        <h2>Not in your library · {results.length}</h2>
      </div>
      <p className="rmab-lane-sub">
        {canRequest
          ? 'Found on Audible - request and ReadMeABook will fetch it.'
          : 'Found on Audible but not in your library yet.'}
      </p>
      <div className="req-grid">
        {results.map((r) => (
          <ResultTile key={r.asin} result={r} canRequest={canRequest} onOpen={setConfirm} />
        ))}
      </div>
      {confirm && (
        <RequestConfirmModal
          target={target}
          book={confirm}
          canRequest={canRequest}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
