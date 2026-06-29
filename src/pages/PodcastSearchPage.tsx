import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  searchPodcasts,
  addPodcast,
  type PodcastDirectoryResult,
} from '@/api/absPodcasts'
import { getMe } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useToast } from '@/hooks/useToast'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// Admin: search the podcast directory (GET /api/search/podcast) and add a feed
// (POST /api/podcasts). Adding requires a podcast-type library to be active;
// otherwise the Add button prompts the user to switch libraries.
export function PodcastSearchPage() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PodcastDirectoryResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const { target } = useActiveServer()
  const { active, activeId } = useActiveLibrary()
  const { toast, show } = useToast()
  const isPodcastLib = active?.mediaType === 'podcast'

  // Admin gate: this surface is reachable only via the admin-gated sidebar item,
  // but we also confirm the server permits writes before wiring the Add action.
  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const canAdd =
    me?.type === 'admin' || me?.type === 'root' || Boolean(me?.permissions?.update)

  const run = async () => {
    const term = q.trim()
    if (!term || !target) return
    setSearching(true)
    try {
      setResults(await searchPodcasts(target, term))
    } finally {
      setSearching(false)
    }
  }

  const add = async (p: PodcastDirectoryResult) => {
    if (!target || !activeId) return
    if (!isPodcastLib) {
      show('Switch to a podcast library to add feeds')
      return
    }
    if (!canAdd) {
      show('You need admin access to add podcasts')
      return
    }
    setAdding(p.id)
    try {
      await addPodcast(target, activeId, p.feedUrl)
      show(`Added ${p.title}`)
    } catch {
      show('Could not add this podcast')
    } finally {
      setAdding(null)
    }
  }

  if (!target) return null

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Podcasts · Admin</div>
        <h1 className="title-xl">Add a podcast</h1>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 28, maxWidth: 640 }}>
        <form
          className="ab-search"
          style={{ flex: 1, maxWidth: 'none' }}
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <Icon name="search" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search podcasts by name…"
          />
        </form>
        <button className="btn-sm btn-accent" disabled={searching} onClick={() => void run()}>
          Search
        </button>
        <button className="btn-sm btn-ghost" onClick={() => show('OPML import is coming soon')}>
          <Icon name="upload_file" /> OPML
        </button>
      </div>

      {searching && <LoadingSpinner className="py-12" label="Searching directory..." />}

      {results && results.length === 0 && (
        <div className="empty-state">
          <Icon name="search_off" />
          <h3>No podcasts found</h3>
        </div>
      )}

      {results && results.length > 0 && (
        <div style={{ maxWidth: 720 }}>
          {results.map((p) => (
            <div className="pod-result" key={p.id}>
              {p.cover ? (
                <img className="pr-cover" src={p.cover} alt="" style={{ objectFit: 'cover' }} />
              ) : (
                <span className="pr-cover" />
              )}
              <div className="pr-meta">
                <div className="pr-title">
                  {p.title}
                  {p.pageUrl && (
                    <a
                      href={p.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: 6 }}
                    >
                      <Icon
                        name="open_in_new"
                        style={{ fontSize: 14, color: 'var(--text-faint)' }}
                      />
                    </a>
                  )}
                </div>
                <div className="pr-sub">
                  {[p.artistName, p.genres[0], `${p.trackCount} episodes`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                className="btn-sm btn-accent"
                style={{ flex: 'none' }}
                disabled={adding === p.id}
                title={isPodcastLib ? 'Add this podcast' : 'Switch to a podcast library to add'}
                onClick={() => void add(p)}
              >
                <Icon name="add" /> {adding === p.id ? 'Adding…' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!results && !searching && (
        <div className="empty-state" style={{ maxWidth: 720 }}>
          <Icon name="travel_explore" />
          <h3>Search the directory</h3>
          <p>Find a show by name, then add its feed to your library.</p>
        </div>
      )}

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
