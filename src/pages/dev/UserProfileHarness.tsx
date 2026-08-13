import { useState } from 'react'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'
import { ListeningHero, ProfileCompare, FinishedShelf } from '@/pages/UserProfilePage'
import type { HSProfileResponse } from '@hearthshelf/core'

// DEV-ONLY visual harness for the user profile surfaces. The real page reads the
// active server + a live /hs/social/profile response, neither of which exists on
// localhost, so this drives the presentational pieces from mock data instead.
// Gated to import.meta.env.DEV in the router.

// No covers, no navigation - the harness only needs layout to render.
const STUB_UI: MediaUI = {
  coverUrl: () => null,
  openItem: () => {},
  playItem: () => {},
}

const BOOKS = [
  { libraryItemId: 'li1', title: 'A Wizard of Earthsea', finishedAt: Date.parse('2026-03-04'), alsoMine: true },
  { libraryItemId: 'li2', title: 'The Tombs of Atuan', finishedAt: Date.parse('2026-04-11'), alsoMine: true },
  { libraryItemId: 'li3', title: 'The Farthest Shore', finishedAt: Date.parse('2026-05-19'), alsoMine: false },
  { libraryItemId: 'li4', title: 'Tehanu', finishedAt: Date.parse('2026-06-02'), alsoMine: false },
  { libraryItemId: 'li5', title: 'Piranesi', finishedAt: Date.parse('2026-07-21'), alsoMine: true },
  { libraryItemId: 'li6', title: 'The Left Hand of Darkness', finishedAt: Date.parse('2026-08-01'), alsoMine: false },
]

const BASE: HSProfileResponse = {
  available: true,
  userId: 'u2',
  username: 'bramblewick',
  isMe: false,
  me: {
    booksFinished: 31,
    secondsListened: 402_000,
    activeDays: 121,
    avgPerActiveDaySec: 3322,
    booksThisYear: 12,
  },
  target: {
    booksFinished: 58,
    secondsListened: 1_040_000,
    activeDays: 190,
    avgPerActiveDaySec: 5473,
    booksThisYear: 24,
  },
  readShared: true,
  listeningShared: true,
  listening: {
    libraryItemId: 'li7',
    title: 'The Long Way to a Small, Angry Planet',
    author: 'Becky Chambers',
    narrator: 'Patricia Rodriguez',
    durationSec: 51_000,
    currentTimeSec: 19_400,
    progress: 0.38,
    isFinished: false,
    lastListenedAt: Date.now() - 1000 * 60 * 42,
    isLive: true,
  },
  finished: BOOKS,
  sharedCount: BOOKS.filter((b) => b.alsoMine).length,
}

// The states worth eyeballing: both gates open, each one closed, and the
// idle (shared-but-not-currently-playing) hero.
const VARIANTS: { id: string; label: string; profile: HSProfileResponse }[] = [
  { id: 'live', label: 'Listening now', profile: BASE },
  {
    id: 'idle',
    label: 'Last listened',
    profile: {
      ...BASE,
      listening: { ...BASE.listening!, isLive: false, lastListenedAt: Date.now() - 1000 * 60 * 60 * 52 },
    },
  },
  {
    id: 'no-listen',
    label: 'Listening private',
    profile: { ...BASE, listeningShared: false, listening: null },
  },
  {
    id: 'no-books',
    label: 'Reading list private',
    profile: { ...BASE, readShared: false, finished: [], sharedCount: 0 },
  },
]

export function UserProfileHarness() {
  const [variant, setVariant] = useState(VARIANTS[0].id)
  const profile = VARIANTS.find((v) => v.id === variant)!.profile

  return (
    <MediaUIProvider value={STUB_UI}>
      <div className="page fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div className="toolbar2" style={{ marginBottom: 20 }}>
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              className={'pill' + (variant === v.id ? ' on' : '')}
              onClick={() => setVariant(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="page-head profile-head">
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'hsl(190 42% 38%)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            BR
          </span>
          <div>
            <div className="eyebrow">Community</div>
            <h1 className="title-xl">{profile.username}</h1>
            <p className="page-sub">
              {Math.round(profile.target.secondsListened / 3600)}h listened &middot;{' '}
              {profile.target.booksFinished} books finished
            </p>
          </div>
        </div>

        {profile.listeningShared && profile.listening && (
          <ListeningHero listen={profile.listening} username={profile.username} onOpen={() => {}} />
        )}
        {!profile.listeningShared && (
          <div className="empty-state">
            <h3>Listening activity is private</h3>
            <p>{profile.username} hasn't turned on "Share when I'm listening".</p>
          </div>
        )}

        <ProfileCompare profile={profile} />
        <FinishedShelf profile={profile} onOpen={() => {}} />
      </div>
    </MediaUIProvider>
  )
}
