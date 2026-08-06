import { useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { ExternalSearchLane } from '@/components/requests/ExternalSearchLane'
import type { AbsTarget } from '@/api/absLibrary'

interface DiscoverSearchProps {
  target: AbsTarget
  // Owned-title keys ("title|author" lowercased) so we never list what's owned.
  ownedKeys: Set<string>
}

// Audible catalog search on Discover. HearthShelf owns this search (our own
// backend), independent of any connector - so it works whether or not the
// request backend is connected. The results grid, request modal, and
// buy-on-Audible fallback are ExternalSearchLane's, shared with Search.
export function DiscoverSearch({ target, ownedKeys }: DiscoverSearchProps) {
  const [q, setQ] = useState('')
  const query = q.trim()

  return (
    <div className="section">
      <form
        className="ab-search"
        onSubmit={(e) => e.preventDefault()}
        style={{ maxWidth: 560, marginBottom: 22 }}
      >
        <span style={{ display: 'grid', placeItems: 'center' }}>
          <Icon name="search" />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Audible for any title..."
        />
        {query && (
          <button type="button" className="ab-clear" onClick={() => setQ('')} title="Clear">
            <Icon name="close" />
          </button>
        )}
      </form>

      {query.length >= 2 && (
        <ExternalSearchLane target={target} query={query} ownedKeys={ownedKeys} />
      )}
    </div>
  )
}
