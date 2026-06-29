import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSearchProviders,
  searchBookMetadata,
  matchItem,
  type AbsMatchResult,
} from '@/api/absMatch'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface ItemMatchTabProps {
  target: AbsTarget
  itemId: string
  defaultTitle: string
  defaultAuthor: string
  onApplied: (msg: string) => void
}

// Compact "5h 12m" label from a run length given in minutes (ABS match duration).
function durationLabel(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// Search a metadata provider and apply a result to the item (overrides details).
export function ItemMatchTab({
  target,
  itemId,
  defaultTitle,
  defaultAuthor,
  onApplied,
}: ItemMatchTabProps) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState('audible')
  const [title, setTitle] = useState(defaultTitle)
  const [author, setAuthor] = useState(defaultAuthor)
  const [results, setResults] = useState<AbsMatchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)

  const { data: providers } = useQuery({
    queryKey: ['abs-search-providers', target.serverId],
    queryFn: () => getSearchProviders(target),
    staleTime: Infinity,
  })

  const run = async () => {
    setSearching(true)
    try {
      setResults(await searchBookMetadata(target, provider, title, author))
    } finally {
      setSearching(false)
    }
  }

  const apply = async (r: AbsMatchResult) => {
    setApplying(r.asin ?? r.title)
    try {
      await matchItem(target, itemId, {
        provider,
        title: r.title,
        author: r.author ?? undefined,
        asin: r.asin,
        isbn: r.isbn,
        overrideCover: true,
        overrideDetails: true,
      })
      qc.invalidateQueries({ queryKey: ['abs-book-detail', target.serverId, itemId] })
      qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, itemId] })
      onApplied(`Matched to "${r.title}"`)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          className="fld"
          style={{ flex: 'none', width: 150 }}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {(providers?.providers.books ?? []).map((p) => (
            <option key={p.value} value={p.value}>
              {p.text}
            </option>
          ))}
        </select>
        <input
          className="fld"
          style={{ flex: 1, minWidth: 120 }}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="fld"
          style={{ flex: 1, minWidth: 120 }}
          placeholder="Author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <button
          className="btn-sm btn-accent"
          style={{ flex: 'none' }}
          disabled={searching}
          onClick={() => void run()}
        >
          <Icon name="search" /> Search
        </button>
      </div>

      {searching && <LoadingSpinner className="py-8" label="Searching..." />}
      {results && results.length === 0 && (
        <div className="pop-empty">No matches from this provider.</div>
      )}
      {results && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r, i) => (
            <div className="match-card" key={r.asin ?? i}>
              {r.cover && (
                <img
                  src={r.cover}
                  alt=""
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 6,
                    objectFit: 'cover',
                    flex: 'none',
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {[
                    r.author,
                    r.publishedYear,
                    r.duration ? durationLabel(r.duration) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                className="btn-sm btn-green"
                style={{ flex: 'none' }}
                disabled={applying !== null}
                onClick={() => void apply(r)}
              >
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
