import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HSClubDetail } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'
import { PlayerClubCompanion } from '@/components/player/PlayerClubCompanion'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'

const TARGET: AbsTarget = { serverId: 'dev', serverUrl: 'http://localhost:0' }
const UI: MediaUI = { coverUrl: () => null, openItem: () => {}, playItem: () => {} }
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
client.setQueryData(['abs-me', 'dev'], { id: 'maya' })

const DETAIL: HSClubDetail = {
  enabled: true,
  club: {
    id: 'dev-club',
    name: 'Epic Fantasy Friends',
    createdBy: 'maya',
    visibility: 'closed',
    isOpen: false,
    archived: false,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    memberCount: 4,
    currentBook: null,
    queuedItemIds: ['q1', 'q2'],
    recBasis: 'club-history',
    allowCommentEditing: true,
    allowReplies: true,
    autoAdvanceOnAllFinished: false,
  },
  books: [],
  queue: [
    {
      libraryItemId: 'q1',
      title: 'The Shadow of What Was Lost',
      author: 'James Islington',
      addedBy: 'maya',
      startedAt: 0,
      finishedAt: null,
      queuedAt: Date.now(),
      abandonedAt: null,
      sortOrder: 0,
    },
    {
      libraryItemId: 'q2',
      title: 'The Way of Kings',
      author: 'Brandon Sanderson',
      addedBy: 'maya',
      startedAt: 0,
      finishedAt: null,
      queuedAt: Date.now(),
      abandonedAt: null,
      sortOrder: 1,
    },
  ],
  members: [
    ['maya', 'Maya', 'owner', 0.48, true],
    ['theo', 'Theo', 'member', 0.31, false],
    ['rin', 'Rin', 'member', 0.67, false],
    ['sam', 'Sam', 'member', 1, false],
  ].map(([userId, username, role, progress, listeningNow]) => ({
    userId: String(userId),
    username: String(username),
    role: role as 'owner' | 'member',
    joinedAt: Date.now(),
    currentTime: Number(progress) * 21600,
    duration: 21600,
    isFinished: Number(progress) === 1,
    listeningNow: Boolean(listeningNow),
    reach: null,
  })),
  notes: { notes: [], locked: [{ id: 'locked', timeSec: 13200 }], hiddenAhead: 1 },
  unreadCount: 1,
}

export function ClubSidecarHarness() {
  return (
    <QueryClientProvider client={client}>
      <MediaUIProvider value={UI}>
        <main className="dev-club-sidecar">
          <PlayerClubCompanion
            target={TARGET}
            detail={DETAIL}
            libraryItemId="current-book"
            position={10368}
            duration={21600}
            focusNoteId={null}
            onSeek={() => {}}
            onClose={() => {}}
            onOpenClub={() => {}}
            onOpenBook={() => {}}
            onToast={() => {}}
          />
        </main>
      </MediaUIProvider>
    </QueryClientProvider>
  )
}
