/**
 * Player header pill that shows at a glance whether your listening has reached the
 * server, and taps to open a dialog explaining the state in plain language with a
 * Sync-now button. The web mirror of the mobile app's SyncStatusIcon + sheet.
 *
 * Three steady looks (no flicker on background syncs):
 *  - green  cloud_done:  server reachable and everything is synced.
 *  - ember  cloud_queue: listening/position not yet on the server, but reachable.
 *  - red    cloud_off:   can't reach the server (a failed sync / offline).
 *
 * The old header pill was a hardcoded "Synced" that never reflected reality; this
 * reads the live syncState store and the offline pending-session queue.
 */
import { useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { usePlayer } from '@/player/PlayerProvider'
import { getSyncState, subscribeSyncState, type SyncStatus } from '@/player/syncState'
import {
  getPendingSessionState,
  subscribePendingSessions,
} from '@/player/pendingProgress'

type Kind = 'synced' | 'pending' | 'offline'

const LOOK: Record<Kind, { icon: string; label: string; cls: string }> = {
  synced: { icon: 'cloud_done', label: 'Synced', cls: 'ok' },
  pending: { icon: 'cloud_queue', label: 'Saving...', cls: 'pending' },
  offline: { icon: 'cloud_off', label: 'Not synced', cls: 'bad' },
}

const COPY: Record<Kind, { title: string; body: string }> = {
  synced: {
    title: 'Progress saved',
    body: 'Your spot and listening time are up to date on your server. Nothing to do.',
  },
  pending: {
    title: 'Catching up',
    body: 'You have listening that has not reached your server yet. It saves on its own as you listen - tap Sync now to push it right away.',
  },
  offline: {
    title: "Can't reach your server",
    body: "Your latest listening is saved in this browser for now. It's not lost - it syncs on its own once your server is reachable. Tap Retry to try again right now.",
  },
}

function kindOf(status: SyncStatus): Kind {
  if (status === 'failed') return 'offline'
  if (status === 'pending') return 'pending'
  return 'synced'
}

function relativeTime(from: number, now: number): string {
  const sec = Math.max(0, Math.round((now - from) / 1000))
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.round(hr / 24)
  return `${day} day${day === 1 ? '' : 's'} ago`
}

type Feedback = 'idle' | 'syncing' | 'ok' | 'fail'

export function SyncStatusPill() {
  const sync = useSyncExternalStore(subscribeSyncState, getSyncState)
  const [open, setOpen] = useState(false)

  if (sync.status === 'idle') return null

  const kind = kindOf(sync.status)
  const look = LOOK[kind]

  return (
    <>
      <button
        className={`pill sync-pill ${look.cls}`}
        onClick={() => setOpen(true)}
        title="Sync status"
      >
        <Icon name={look.icon} /> {look.label}
      </button>
      {open && <SyncStatusDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function SyncStatusDialog({ onClose }: { onClose: () => void }) {
  const sync = useSyncExternalStore(subscribeSyncState, getSyncState)
  const pending = useSyncExternalStore(subscribePendingSessions, getPendingSessionState)
  const { forceSyncNow } = usePlayer()
  const [feedback, setFeedback] = useState<Feedback>('idle')

  const kind = kindOf(sync.status)
  const look = LOOK[kind]
  const copy = COPY[kind]
  const lastSynced =
    sync.lastSyncedAt != null ? relativeTime(sync.lastSyncedAt, Date.now()) : null
  const queued = useMemo(() => [...pending.byId.values()], [pending])

  const syncing = feedback === 'syncing'
  const retry = kind !== 'synced'

  const onSync = async () => {
    setFeedback('syncing')
    const ok = await forceSyncNow()
    setFeedback(ok ? 'ok' : 'fail')
  }

  const btnLabel = syncing
    ? 'Syncing...'
    : feedback === 'ok'
      ? 'Synced'
      : retry
        ? 'Retry sync'
        : 'Sync now'

  return (
    <Modal title="Sync" onClose={onClose}>
      <div className="sync-dialog">
        <div className={`sync-dialog-badge ${look.cls}`}>
          <Icon name={look.icon} />
        </div>
        <h3>{copy.title}</h3>
        <p className="sync-dialog-body">{copy.body}</p>

        {lastSynced && (
          <div className="sync-dialog-meta">
            <Icon name="check_circle" /> Last saved to server {lastSynced}
          </div>
        )}

        {queued.length > 0 && (
          <div className="sync-dialog-queued">
            <div className="sync-dialog-queued-head">
              {queued.length === 1
                ? '1 offline session waiting to sync'
                : `${queued.length} offline sessions waiting to sync`}
            </div>
            {queued.slice(0, 4).map((s) => (
              <div key={s.libraryItemId} className="sync-dialog-queued-row">
                <Icon name="cloud_queue" />
                <span>{s.displayTitle}</span>
              </div>
            ))}
            {queued.length > 4 && (
              <div className="sync-dialog-queued-more">and {queued.length - 4} more</div>
            )}
          </div>
        )}

        {feedback === 'ok' ? (
          <div className="sync-dialog-result ok">
            <Icon name="check_circle" /> Saved to your server
          </div>
        ) : feedback === 'fail' ? (
          <div className="sync-dialog-result bad">
            <Icon name="error" /> Still couldn't reach your server. Your listening is kept
            safely and will sync on its own once your server is reachable.
          </div>
        ) : null}

        <button className="sync-dialog-btn" disabled={syncing} onClick={onSync}>
          <Icon name={feedback === 'ok' ? 'check_circle' : retry ? 'refresh' : 'cloud_sync'} />
          {btnLabel}
        </button>
      </div>
    </Modal>
  )
}
