import { useState } from 'react'
import { PlayerProvider } from '@/player/PlayerProvider'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'
import { CarPlayer } from '@/components/player/CarPlayer'
import { CarBookProgress } from '@/components/player/CarBookProgress'
import { CarCommentAlert } from '@/components/player/CarCommentAlert'
import { ReturnPositionPill } from '@/components/player/ReturnPositionPill'
import { useIdleFade } from '@/hooks/useIdleFade'
import { useVisualViewportSize } from '@/hooks/useVisualViewportSize'
import cozyHearth from '@/assets/img/SittingInTheHearth.webp'
import type { HSClubDetail, TimelineMarker } from '@hearthshelf/core'

// Minimal stub so shared components (Cover) can read the media seam. No covers,
// no navigation - the harness only needs the layout to render.
const STUB_UI: MediaUI = {
  coverUrl: () => null,
  openItem: () => {},
  playItem: () => {},
}

// DEV-ONLY visual harness for the car-mode player. Renders CarPlayer with stub
// data outside the auth/server stack so the layout, drag, resize, and idle-fade
// can be checked without Clerk or a live ABS server. Gated to import.meta.env.DEV
// in the router - never reachable in a production build.
// One of each marker state, so the car layout can be eyeballed here without a
// real club: a single note, a cluster, a locked-ahead stub, and a mixed cluster.
// The 0.2 cluster sits just ahead of the harness's start position so the
// upcoming-comment countdown is visible without scrubbing.
const MARKERS: TimelineMarker[] = [
  { kind: 'note', fraction: 0.18, count: 1, items: [{ id: 'm0', timeSec: 3888, kind: 'note' }] },
  { kind: 'note', fraction: 0.2, count: 3, items: [{ id: 'm1', timeSec: 4320, kind: 'note' }] },
  { kind: 'stub', fraction: 0.71, count: 1, items: [{ id: 'm2', timeSec: 15336, kind: 'stub' }] },
  { kind: 'mixed', fraction: 0.88, count: 2, items: [{ id: 'm3', timeSec: 19008, kind: 'note' }] },
]

const CHAPTERS = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  start: i * 1800,
  end: (i + 1) * 1800,
  title: `Chapter ${i + 1}: The Long Road`,
}))

const CLUB: HSClubDetail = {
  enabled: true,
  club: {
    id: 'dev-club',
    name: 'Epic Fantasy Friends',
    createdBy: 'maya',
    visibility: 'closed',
    isOpen: true,
    archived: false,
    createdAt: 0,
    lastActivityAt: 0,
    memberCount: 3,
    currentBook: null,
    queuedItemIds: [],
    recBasis: 'club-history',
    allowCommentEditing: true,
    allowReplies: true,
    autoAdvanceOnAllFinished: false,
  },
  books: [],
  queue: [],
  members: [
    {
      userId: 'maya',
      username: 'Maya',
      role: 'owner',
      joinedAt: 0,
      currentTime: 6900,
      duration: 21600,
      isFinished: false,
      listeningNow: true,
      reach: null,
    },
    {
      userId: 'theo',
      username: 'Theo',
      role: 'member',
      joinedAt: 0,
      currentTime: 4200,
      duration: 21600,
      isFinished: false,
      listeningNow: false,
      reach: null,
    },
    {
      userId: 'rin',
      username: 'Rin',
      role: 'member',
      joinedAt: 0,
      currentTime: 9700,
      duration: 21600,
      isFinished: false,
      listeningNow: false,
      reach: null,
    },
  ],
  notes: {
    notes: [
      {
        id: 'n1',
        libraryItemId: 'dev-stub',
        userId: 'maya',
        username: 'Maya',
        body: 'The well scene got me. I had to pull over.',
        timeSec: 3200,
        createdAt: 1,
        updatedAt: null,
        parentId: '',
        spoiler: false,
        safe: false,
        visibility: 'club',
        clubId: 'dev-club',
        reactions: [],
        mentions: [],
      },
      {
        id: 'n2',
        libraryItemId: 'dev-stub',
        userId: 'theo',
        username: 'Theo',
        body: 'Same. The narrator absolutely nails that whole chapter.',
        timeSec: 4100,
        createdAt: 2,
        updatedAt: null,
        parentId: '',
        spoiler: false,
        safe: false,
        visibility: 'club',
        clubId: 'dev-club',
        reactions: [],
        mentions: [],
      },
      {
        id: 'n3',
        libraryItemId: 'dev-stub',
        userId: 'rin',
        username: 'Rin',
        body: 'Wait until the next one. That is all I am going to say.',
        timeSec: 4400,
        createdAt: 3,
        updatedAt: null,
        parentId: '',
        spoiler: false,
        safe: false,
        visibility: 'club',
        clubId: 'dev-club',
        reactions: [],
        mentions: [],
      },
    ],
    locked: [],
    hiddenAhead: 0,
  },
  unreadCount: 2,
}

// The club companion needs a target to key its queries on. The requests it
// makes (avatars, /me) just fail here, which is what the harness wants: the
// layout renders without a live server behind it.
const STUB_TARGET = { serverId: 'dev', serverUrl: 'http://localhost:0' }

export function CarPlayerHarness() {
  const [pos, setPos] = useState(3600 + 600)
  const [openClubSignal, setOpenClubSignal] = useState(0)
  const [clubChatOpen, setClubChatOpen] = useState(false)
  // Always-on in the harness so the pill's drag-to-dismiss can be exercised
  // without staging a real backwards seek.
  const [returnAt, setReturnAt] = useState<number | null>(5400)
  const [playing, setPlaying] = useState(true)
  const [rate, setRate] = useState(1.5)
  const duration = CHAPTERS.length * 1800

  const ci = Math.min(CHAPTERS.length - 1, Math.floor(pos / 1800))
  const cur = CHAPTERS[ci]
  const seekClamp = (sec: number) => setPos(Math.max(0, Math.min(duration, sec)))
  // Long enough to inspect a sheet without it fading mid-look; short enough
  // that the fade itself can still be eyeballed here.
  const idleFade = useIdleFade(true, 20000)
  const vv = useVisualViewportSize()

  return (
    <PlayerProvider>
      <MediaUIProvider value={STUB_UI}>
        <div
          className="player car-mode hearth-bg"
          style={vv.width ? { width: vv.width, height: vv.height } : undefined}
        >
          <div
            className="player-hearth-bg car-bg"
            aria-hidden="true"
            style={{
              backgroundImage: `url("${cozyHearth}")`,
              ...(vv.width ? { width: vv.width, height: vv.height } : {}),
            }}
            onPointerDown={idleFade.wake}
          />
          <CarBookProgress
            position={pos}
            duration={duration}
            chapterIndex={ci}
            chapterCount={CHAPTERS.length}
            members={CLUB.members}
            markers={MARKERS}
            onOpenClub={() => setOpenClubSignal((n) => n + 1)}
          />
          <CarCommentAlert
            markers={MARKERS}
            position={pos}
            rate={rate}
            suppressed={clubChatOpen}
          />
          {returnAt !== null && (
            <div className="car-return-pill">
              <ReturnPositionPill
                position={returnAt}
                onJump={() => {
                  seekClamp(returnAt)
                  setReturnAt(null)
                }}
                onDismiss={() => setReturnAt(null)}
              />
            </div>
          )}
          <CarPlayer
            libraryItemId="dev-stub"
            title="The Wind-Up Bird Chronicle"
            author="Haruki Murakami"
            chapters={CHAPTERS}
            ci={ci}
            cur={cur}
            pos={pos}
            duration={duration}
            isPlaying={playing}
            rate={rate}
            setRate={setRate}
            togglePlay={() => setPlaying((p) => !p)}
            seekClamp={seekClamp}
            prevCh={() => seekClamp(CHAPTERS[Math.max(0, ci - 1)].start)}
            nextCh={() => seekClamp(CHAPTERS[Math.min(CHAPTERS.length - 1, ci + 1)].start)}
            onExit={() => alert('exit car mode')}
            scrubber="chapter"
            faded={idleFade.faded}
            wake={idleFade.wake}
            tick={idleFade.tick}
            canReadAlong
            clubDetail={CLUB}
            target={STUB_TARGET}
            openClubSignal={openClubSignal}
            onClubOpenChange={setClubChatOpen}
            onToast={() => {}}
          />
        </div>
      </MediaUIProvider>
    </PlayerProvider>
  )
}
