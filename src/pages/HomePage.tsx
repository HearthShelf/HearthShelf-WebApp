import { useUser } from '@clerk/clerk-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useShelves } from '@/hooks/useLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { BookTile } from '@/components/shared/BookTile'
import { Icon } from '@/components/common/Icon'
import type { AbsListItem, Shelf } from '@/api/absLibrary'

// Home shelves we surface, in display order. Any shelf id not listed is ignored.
const SHELF_ORDER = ['continue-listening', 'recently-added', 'discover'] as const

const SHELF_ICONS: Record<string, string> = {
  'continue-listening': 'play_circle',
  'recently-added': 'schedule',
  discover: 'explore',
}

function shelfRank(id: string): number {
  const i = SHELF_ORDER.indexOf(id as (typeof SHELF_ORDER)[number])
  return i === -1 ? SHELF_ORDER.length : i
}

function greetingWord(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Big "jump back in" card for the first continue-listening item. */
function ResumeHero({ item }: { item: AbsListItem }) {
  const ui = useMediaUI()
  const cover = ui.coverUrl(item.id, 440)

  return (
    <div className="hero-resume-card">
      <button
        type="button"
        onClick={() => ui.openItem(item.id)}
        style={{
          width: 220,
          height: 220,
          flex: 'none',
          padding: 0,
          border: 'none',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--c-highest)',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-lift)',
        }}
        aria-label={`Open ${item.title}`}
      >
        {cover ? (
          <img
            src={cover}
            alt={item.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '100%',
              height: '100%',
              color: 'var(--text-muted)',
            }}
          >
            <Icon name="menu_book" />
          </span>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Jump back in
        </div>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
          {item.title}
        </h2>
        {item.author && (
          <div style={{ color: 'var(--text-muted)', fontSize: 14.5, marginBottom: 22 }}>
            {item.author}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => ui.playItem(item.id)}>
            <Icon name="play_arrow" fill /> Resume
          </button>
          <button className="pill" onClick={() => ui.openItem(item.id)}>
            <Icon name="info" /> Details
          </button>
        </div>
      </div>
    </div>
  )
}

export function HomePage() {
  const { user } = useUser()
  const { target } = useActiveServer()
  const { active, activeId } = useActiveLibrary()

  // The page renders inside <ActiveServerMediaUI>, so target is connected by the
  // time we render. Guard defensively anyway.
  const { data: shelves, isLoading } = useShelves(
    target ?? { serverId: '', serverUrl: '' },
    activeId ?? undefined,
    Boolean(target) && Boolean(activeId)
  )

  if (!target) return null

  const name = user?.firstName || user?.username || 'there'

  const ordered: Shelf[] = (shelves ?? [])
    .filter((s) => s.items.length > 0 && shelfRank(s.id) < SHELF_ORDER.length)
    .sort((a, b) => shelfRank(a.id) - shelfRank(b.id))

  const hero = ordered.find((s) => s.id === 'continue-listening')?.items[0]

  return (
    <div className="page fade-in">
      <div className="home-head-row">
        <div>
          <div className="eyebrow">HearthShelf</div>
          <h1 className="title-xl">
            {greetingWord()}, {name}
          </h1>
          <p className="page-sub">
            {hero ? (
              <>
                Pick up where you left off
                {active && ` in ${active.name}`}
              </>
            ) : (
              'Nothing in progress yet'
            )}
          </p>
        </div>
      </div>

      {hero && <ResumeHero item={hero} />}

      {isLoading && <p className="page-sub">Loading shelves...</p>}

      {ordered.map((sh) => (
        <div className="section" key={sh.id}>
          <div className="section-head">
            <Icon name={SHELF_ICONS[sh.id] ?? 'library_books'} />
            <h2>{sh.label}</h2>
          </div>
          <div className="shelf-row">
            {sh.items.map((it) => (
              <div key={it.id} className="book" style={{ width: 150, flex: 'none' }}>
                <BookTile item={{ id: it.id, title: it.title, author: it.author }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
