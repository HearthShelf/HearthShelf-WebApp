import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getProfile, socialKeys } from '@/api/absSocial'
import type { HSProfileResponse, HSProfileListen, HSProfileBook } from '@hearthshelf/core'
import { Cover } from '@/components/shared/Cover'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import type { AbsTarget } from '@/api/absLibrary'

// Compact "3h 20m" / "45m" from seconds. Matches StatsPage's tile formatting.
function hmLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// "2 days ago" / "just now" for the last-listened line. Coarse on purpose - this
// is presence, not an audit trail.
function agoLabel(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

function yearOf(ms: number | null): string {
  return ms ? String(new Date(ms).getFullYear()) : ''
}

// The hero: what they're listening to now, or last listened to. This is the
// whole point of the page - seeing "80h this week" and being able to find out
// what it was spent on, without walking the library book by book.
export function ListeningHero({
  listen,
  username,
  onOpen,
}: {
  listen: HSProfileListen
  username: string
  onOpen: (itemId: string) => void
}) {
  const pct = Math.round(
    Math.min(Math.max(listen.progress || 0, 0), 1) * 100,
  )
  const remaining = Math.max(listen.durationSec - listen.currentTimeSec, 0)

  return (
    <div className="series-hero profile-hero">
      <div className="hero-covers solo">
        <Cover
          itemId={listen.libraryItemId}
          title={listen.title || 'Untitled'}
          author={listen.author}
          fs={13}
          onClick={() => onOpen(listen.libraryItemId)}
          style={{ cursor: 'pointer' }}
        />
      </div>
      <div className="series-hero-meta">
        <div className="eyebrow">
          {listen.isLive ? (
            <span className="live-dot-label">
              <i className="live-dot" />
              Listening now
            </span>
          ) : listen.isFinished ? (
            'Last finished'
          ) : (
            'Last listened to'
          )}
        </div>
        <h2 className="profile-hero-title" onClick={() => onOpen(listen.libraryItemId)}>
          {listen.title || 'Untitled'}
        </h2>
        {listen.author && <p className="page-sub">by {listen.author}</p>}
        {listen.narrator && <p className="page-sub">Narrated by {listen.narrator}</p>}

        {listen.durationSec > 0 && (
          <div className="profile-hero-prog">
            <div className="compare-bar">
              <i style={{ width: pct + '%' }} />
            </div>
            <div className="profile-hero-prog-meta">
              <span>{pct}% through</span>
              {remaining > 0 && !listen.isFinished && <span>{hmLabel(remaining)} left</span>}
            </div>
          </div>
        )}

        {!listen.isLive && listen.lastListenedAt && (
          <p className="page-sub profile-hero-ago">
            {username} listened {agoLabel(listen.lastListenedAt)}
          </p>
        )}
      </div>
    </div>
  )
}

// Side-by-side totals. Same markup/CSS as StatsPage's CompareCard, but always a
// user-vs-user comparison. A row renders only when BOTH sides carry a number, so
// an older server that omits a field never draws a misleading 0-vs-real bar.
export function ProfileCompare({ profile }: { profile: HSProfileResponse }) {
  const roundInt = (n: number) => String(Math.round(n))
  const hoursFmt = (n: number) => `${n.toFixed(1)}h`
  const specs: {
    label: string
    me: number | null | undefined
    target: number | null | undefined
    fmt: (n: number) => string
  }[] = [
    {
      label: 'Books finished',
      me: profile.me.booksFinished,
      target: profile.target.booksFinished,
      fmt: roundInt,
    },
    {
      label: 'Hours listened',
      me: profile.me.secondsListened / 3600,
      target: profile.target.secondsListened / 3600,
      fmt: hoursFmt,
    },
    {
      label: 'Books this year',
      me: profile.me.booksThisYear,
      target: profile.target.booksThisYear,
      fmt: roundInt,
    },
    {
      label: 'Active days',
      me: profile.me.activeDays,
      target: profile.target.activeDays,
      fmt: roundInt,
    },
    {
      label: 'Avg / active day',
      me: profile.me.avgPerActiveDaySec != null ? profile.me.avgPerActiveDaySec / 3600 : undefined,
      target:
        profile.target.avgPerActiveDaySec != null
          ? profile.target.avgPerActiveDaySec / 3600
          : undefined,
      fmt: hoursFmt,
    },
  ]
  const rows = specs.filter(
    (s): s is { label: string; me: number; target: number; fmt: (n: number) => string } =>
      typeof s.me === 'number' && typeof s.target === 'number',
  )
  if (!rows.length) return null

  return (
    <div className="section">
      <div className="section-head">
        <Icon name="compare_arrows" />
        <h2>Head to head</h2>
      </div>
      <div className="chart-card" style={{ marginTop: 0 }}>
        <div className="compare-head">
          <span>You</span>
          <span>{profile.username || 'That listener'}</span>
        </div>
        {rows.map((r) => {
          const max = Math.max(r.me, r.target, 0.001)
          return (
            <div className="compare-row" key={r.label}>
              <div className="compare-label">{r.label}</div>
              <div className="compare-bars">
                <div className="compare-side me">
                  <div className="compare-bar">
                    <i style={{ width: (r.me / max) * 100 + '%' }} />
                  </div>
                  <span className="compare-val">{r.fmt(r.me)}</span>
                </div>
                <div className="compare-side target">
                  <div className="compare-bar">
                    <i style={{ width: (r.target / max) * 100 + '%' }} />
                  </div>
                  <span className="compare-val">{r.fmt(r.target)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type BookFilter = 'all' | 'shared'

// Their finished books, with the ones you've both read called out. Defaults to
// "both" when there's any overlap - that's the interesting view when you've
// landed here from the leaderboard.
export function FinishedShelf({
  profile,
  onOpen,
}: {
  profile: HSProfileResponse
  onOpen: (itemId: string) => void
}) {
  const hasShared = profile.sharedCount > 0
  const [filter, setFilter] = useState<BookFilter>(hasShared ? 'shared' : 'all')

  const books = useMemo(
    () => (filter === 'shared' ? profile.finished.filter((b) => b.alsoMine) : profile.finished),
    [profile.finished, filter],
  )

  if (!profile.readShared) {
    return (
      <div className="section">
        <div className="section-head">
          <Icon name="menu_book" />
          <h2>Finished books</h2>
        </div>
        <div className="empty-state">
          <Icon name="lock" />
          <h3>Reading list is private</h3>
          <p>
            {profile.username || 'This listener'} hasn't turned on &ldquo;Share my reading
            list&rdquo;, so their finished books stay hidden.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-head">
        <Icon name="menu_book" />
        <h2>Finished books</h2>
      </div>
      <div className="toolbar2" style={{ marginBottom: 12 }}>
        <button
          className={'pill' + (filter === 'all' ? ' on' : '')}
          onClick={() => setFilter('all')}
        >
          All {profile.finished.length}
        </button>
        <button
          className={'pill' + (filter === 'shared' ? ' on' : '')}
          onClick={() => setFilter('shared')}
          disabled={!hasShared}
        >
          You both finished {profile.sharedCount}
        </button>
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <Icon name="menu_book" />
          <h3>{filter === 'shared' ? 'No books in common yet' : 'Nothing finished yet'}</h3>
          <p>
            {filter === 'shared'
              ? "You haven't finished any of the same books."
              : `${profile.username || 'This listener'} hasn't finished a book yet.`}
          </p>
        </div>
      ) : (
        <div className="lib-grid compact">
          {books.map((b: HSProfileBook) => (
            <div className="book" key={b.libraryItemId} onClick={() => onOpen(b.libraryItemId)}>
              <Cover
                itemId={b.libraryItemId}
                title={b.title || 'Untitled'}
                fs={9}
                finished={b.alsoMine}
              />
              <div className="b-meta">
                <div className="b-title">{b.title || 'Untitled'}</div>
                <div className="b-author">
                  {b.alsoMine ? <span className="badge-pill">Both read</span> : yearOf(b.finishedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One listener's profile: their now-listening hero, their totals against yours,
 * and the books you've both finished. Reached from the Stats leaderboard.
 *
 * Every section is privacy-gated server-side (see /hs/social/profile). This page
 * deliberately distinguishes "they keep this private" from "the feature isn't
 * available" - a deliberate opt-out should read as a choice, not a broken page.
 */
export function UserProfilePage() {
  const { userId = '' } = useParams()
  const navigate = useNavigate()
  const { target, isLoading: serverLoading } = useActiveServer()

  const { data, isLoading, error } = useQuery({
    queryKey: socialKeys.profile(target?.serverId ?? '', userId),
    queryFn: () => getProfile(target as AbsTarget, userId),
    enabled: Boolean(target && userId),
    // Presence moves; keep the hero reasonably fresh without hammering the box.
    refetchInterval: 60_000,
  })

  const openBook = (itemId: string) => navigate(`/book/${itemId}`)

  if (serverLoading || isLoading) {
    return (
      <div className="page">
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <ErrorState message="Couldn't load this profile." />
      </div>
    )
  }

  if (data?.status === 'not-shared') {
    return (
      <div className="page fade-in">
        <div className="page-head">
          <div className="eyebrow">Community</div>
          <h1 className="title-xl">Private profile</h1>
        </div>
        <div className="empty-state">
          <Icon name="lock" />
          <h3>This listener keeps their activity private</h3>
          <p>They haven't opted into sharing, so there's no profile to show.</p>
        </div>
      </div>
    )
  }

  if (data?.status !== 'ok') {
    return (
      <div className="page fade-in">
        <div className="page-head">
          <div className="eyebrow">Community</div>
          <h1 className="title-xl">Profile unavailable</h1>
        </div>
        <div className="empty-state">
          <Icon name="group_off" />
          <h3>Profiles aren't available on this server</h3>
          <p>Community features need the HearthShelf backend connected to your library.</p>
        </div>
      </div>
    )
  }

  const profile = data.profile

  return (
    <div className="page fade-in">
      <div className="page-head profile-head">
        <Avatar name={profile.username} target={target} userId={profile.userId} size={64} />
        <div>
          <div className="eyebrow">Community</div>
          <h1 className="title-xl">
            {profile.username || 'Listener'}
            {profile.isMe && <small className="profile-you"> (you)</small>}
          </h1>
          <p className="page-sub">
            {Math.round(profile.target.secondsListened / 3600)}h listened &middot;{' '}
            {profile.target.booksFinished} books finished
          </p>
        </div>
      </div>

      {profile.listeningShared && profile.listening && (
        <ListeningHero
          listen={profile.listening}
          username={profile.username || 'They'}
          onOpen={openBook}
        />
      )}

      {profile.listeningShared && !profile.listening && (
        <div className="empty-state">
          <Icon name="headphones" />
          <h3>Nothing playing</h3>
          <p>No recent listening to show.</p>
        </div>
      )}

      {!profile.listeningShared && (
        <div className="empty-state">
          <Icon name="lock" />
          <h3>Listening activity is private</h3>
          <p>
            {profile.username || 'This listener'} hasn't turned on &ldquo;Share when I'm
            listening&rdquo;.
          </p>
        </div>
      )}

      {!profile.isMe && <ProfileCompare profile={profile} />}

      <FinishedShelf profile={profile} onOpen={openBook} />
    </div>
  )
}
