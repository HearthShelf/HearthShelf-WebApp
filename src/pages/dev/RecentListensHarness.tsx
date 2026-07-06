import { useQueryClient } from '@tanstack/react-query'
import { RecentListens } from '@/components/player/RecentListens'

// DEV-ONLY visual harness for the enriched Recent Listens layout. Seeds the query
// cache with a stub server + a few mock sessions so the row layout (accent
// "listened" duration, mono time range, chapter range) renders without Clerk or a
// live ABS server. Gated to import.meta.env.DEV in the router.

const ITEM_ID = 'stub-item'
const SERVER_ID = 'stub-server'

const CHAPTERS = Array.from({ length: 12 }, (_, i) => ({
  title: `Chapter ${i + 1}: The Long Road`,
  start: i * 1800,
  end: (i + 1) * 1800,
}))

const SESSIONS = [
  {
    id: 's1',
    libraryItemId: ITEM_ID,
    startTime: 3600,
    currentTime: 5400,
    timeListening: 1500,
    startedAt: Date.now() - 2 * 3600_000,
    deviceInfo: { osName: 'Android' },
  },
  {
    id: 's2',
    libraryItemId: ITEM_ID,
    startTime: 5400,
    currentTime: 6100,
    timeListening: 680,
    startedAt: Date.now() - 26 * 3600_000,
    deviceInfo: { browserName: 'Chrome' },
  },
  {
    id: 's3',
    libraryItemId: ITEM_ID,
    startTime: 900,
    currentTime: 1750,
    timeListening: 800,
    startedAt: Date.now() - 3 * 24 * 3600_000,
    deviceInfo: {},
  },
  {
    id: 's4',
    libraryItemId: ITEM_ID,
    startTime: 1750,
    currentTime: 3200,
    timeListening: 1400,
    startedAt: Date.now() - 4 * 24 * 3600_000,
    deviceInfo: { deviceId: 'hearthshelf-auto', clientName: 'HearthShelf Auto' },
  },
  {
    id: 's5',
    libraryItemId: ITEM_ID,
    startTime: 3200,
    currentTime: 4000,
    timeListening: 780,
    startedAt: Date.now() - 5 * 24 * 3600_000,
    deviceInfo: { deviceId: 'hearthshelf-ios-carplay', clientName: 'HearthShelf iOS' },
  },
  {
    id: 's6',
    libraryItemId: ITEM_ID,
    startTime: 4000,
    currentTime: 5200,
    timeListening: 1150,
    startedAt: Date.now() - 6 * 24 * 3600_000,
    deviceInfo: { deviceId: 'hearthshelf-mobile', clientName: 'HearthShelf Mobile' },
  },
]

export function RecentListensHarness() {
  const qc = useQueryClient()
  qc.setQueryData(['servers'], [{ id: SERVER_ID, name: 'Stub', url: 'https://stub.local' }])
  qc.setQueryData(['abs-recent-sessions', SERVER_ID], SESSIONS)

  return (
    <div style={{ maxWidth: 460, margin: '40px auto', padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>Recent listens</h2>
      <RecentListens libraryItemId={ITEM_ID} chapters={CHAPTERS} onSeek={() => {}} />
    </div>
  )
}
