import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { searchCovers, updateItemCover } from '@/api/absMatch'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Cover } from '@/components/shared/Cover'

interface ItemCoverTabProps {
  target: AbsTarget
  itemId: string
  defaultTitle: string
  defaultAuthor: string
  onApplied: (msg: string) => void
}

// Current cover preview + provider cover search; clicking a result sets it.
export function ItemCoverTab({
  target,
  itemId,
  defaultTitle,
  defaultAuthor,
  onApplied,
}: ItemCoverTabProps) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState('audible')
  const [title, setTitle] = useState(defaultTitle)
  const [covers, setCovers] = useState<string[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')

  const run = async () => {
    setSearching(true)
    try {
      setCovers(await searchCovers(target, provider, title, defaultAuthor))
    } finally {
      setSearching(false)
    }
  }

  const apply = async (url: string) => {
    setApplying(url)
    try {
      await updateItemCover(target, itemId, url)
      qc.invalidateQueries({ queryKey: ['abs-book-detail', target.serverId, itemId] })
      qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, itemId] })
      onApplied('Cover updated')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="cover-tab">
      <div className="cur">
        <Cover itemId={itemId} title={defaultTitle} author={defaultAuthor} width={240} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Current</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="fld"
            placeholder="https://…/cover.jpg"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <button
            className="btn-sm btn-ghost"
            style={{ flex: 'none' }}
            disabled={!urlInput.trim() || applying !== null}
            onClick={() => void apply(urlInput.trim())}
          >
            Add URL
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <select
            className="fld"
            style={{ flex: 'none', width: 130 }}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="audible">Audible</option>
            <option value="google">Google</option>
            <option value="itunes">iTunes</option>
            <option value="openlibrary">Open Library</option>
          </select>
          <input
            className="fld"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
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
        {covers && covers.length === 0 && <div className="pop-empty">No covers found.</div>}
        {covers && covers.length > 0 && (
          <div className="cover-search-grid">
            {covers.map((url) => (
              <button
                key={url}
                onClick={() => void apply(url)}
                disabled={applying !== null}
                style={{
                  border: 'none',
                  padding: 0,
                  background: 'none',
                  cursor: 'pointer',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <img
                  src={url}
                  alt=""
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
