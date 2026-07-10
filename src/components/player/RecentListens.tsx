import { useEffect, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRecentSessions } from '@/api/absPlayback'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatTimestamp, fmtSessDate } from '@hearthshelf/core'
import { DeviceKindIcon } from '@/components/common/DeviceKindIcon'
import { getSyncState, subscribeSyncState } from '@/player/syncState'
import { getPendingSessionState, subscribePendingSessions } from '@/player/pendingProgress'
import type { ABSDeviceInfo } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'

/** Minimal chapter shape needed to label a session's position range. All player
 *  call sites already normalize chapters to { title, start, end } in seconds. */
interface ChapterSpan {
  title: string
  start: number
  end: number
}

/** A unified Recent Listens row: the live "Now" session, a local unsynced
 *  session, or a confirmed server session. `synced`/`offline` drive the accent so
 *  the list doubles as a sync dashboard, matching the mobile app. */
interface RecentRow {
  key: string
  kind: 'live' | 'pending' | 'server'
  synced: boolean
  offline: boolean
  startedAt: number
  startTime: number
  currentTime: number
  timeListening: number
  deviceInfo?: ABSDeviceInfo
}

// Recent listening sessions for the book that is playing now. Tapping a row
// jumps the player back to where that session started. Shared by the mobile
// player sheet and the desktop player popover. The pinned "Now" row (live) and
// any offline-banked rows read as in-flight syncs (cloud glyph + ember/red),
// while confirmed server rows show the device that recorded them.
export function RecentListens({
  libraryItemId,
  chapters,
  onSeek,
}: {
  libraryItemId: string
  /** Book chapters, so each session row can show the chapter(s) it spanned. When
   *  omitted the chapter line is simply hidden. */
  chapters?: ChapterSpan[]
  onSeek: (seconds: number) => void
}) {
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: ['abs-recent-sessions', target?.serverId],
    queryFn: () => getRecentSessions(target as AbsTarget),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const sync = useSyncExternalStore(subscribeSyncState, getSyncState)
  const pending = useSyncExternalStore(subscribePendingSessions, getPendingSessionState)

  // Tick once a second so the live "Now" row's listened-time counts up visibly.
  const [, force] = useState(0)
  useEffect(() => {
    const live = sync.live && sync.live.itemId === libraryItemId
    if (!live) return
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [sync.live, libraryItemId])

  const serverSessions = useMemo(
    () => (data ?? []).filter((s) => s.libraryItemId === libraryItemId),
    [data, libraryItemId],
  )

  // Unified, sync-aware rows: the live "Now" session, any offline-banked session
  // for this book, then the server's confirmed sessions (newest first already).
  const rows: RecentRow[] = useMemo(() => {
    const out: RecentRow[] = []
    const live = sync.live
    if (live && live.itemId === libraryItemId) {
      out.push({
        key: 'live',
        kind: 'live',
        synced: sync.status === 'synced',
        offline: sync.status === 'failed',
        startedAt: live.startedAt,
        startTime: live.startTime,
        currentTime: live.currentTime,
        timeListening: live.timeListening,
      })
    }
    const banked = pending.byId.get(libraryItemId)
    if (banked) {
      out.push({
        key: 'pending',
        kind: 'pending',
        synced: false,
        offline: true,
        startedAt: banked.startedAt,
        startTime: Math.max(0, banked.currentTime - banked.timeListening),
        currentTime: banked.currentTime,
        timeListening: banked.timeListening,
      })
    }
    for (const s of serverSessions) {
      out.push({
        key: s.id,
        kind: 'server',
        synced: true,
        offline: false,
        startedAt: s.startedAt,
        startTime: s.startTime,
        currentTime: s.currentTime,
        timeListening: s.timeListening,
        deviceInfo: s.deviceInfo,
      })
    }
    return out
  }, [sync, pending, serverSessions, libraryItemId])

  const chapterAt = (sec: number): string | null => {
    const c = chapters?.find((ch) => sec >= ch.start && sec < ch.end)
    return c?.title ?? null
  }

  if (isLoading && rows.length === 0) {
    return <LoadingSpinner className="py-8" label="Loading..." />
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '30px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        You haven't listened to this book yet.
      </div>
    )
  }

  return (
    <div className="recent-listens">
      {rows.map((r) => {
        const dt = fmtSessDate(r.startedAt)
        const startCh = chapterAt(r.startTime)
        const endCh = chapterAt(r.currentTime)
        const chapterLabel =
          startCh && endCh && startCh !== endCh ? `${startCh} → ${endCh}` : (endCh ?? startCh)
        const live = r.kind === 'live'
        // Ember for the live/in-flight accent, red when offline-banked, green
        // once the server has it (server rows keep the muted device tint).
        const accent = r.synced
          ? 'var(--primary)'
          : r.offline
            ? '#e0846f'
            : 'var(--primary)'
        return (
          <button
            key={r.key}
            className={'recent-row' + (live ? ' recent-row-live' : '')}
            onClick={() => onSeek(r.currentTime)}
            title="Play from where this session left off"
          >
            {r.kind === 'server' ? (
              <DeviceKindIcon
                deviceInfo={r.deviceInfo}
                size={19}
                style={{ color: 'var(--text-muted)' }}
              />
            ) : (
              <Icon
                name={r.offline ? 'cloud_off' : r.synced ? 'cloud_done' : 'cloud_queue'}
                style={{ color: accent, fontSize: 19 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="schedule" style={{ color: 'var(--primary)', fontSize: 15 }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)' }}>
                  {formatTimestamp(r.timeListening)} listened
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {live
                    ? `Now · ${dt.time}`
                    : r.kind === 'pending'
                      ? 'Not synced yet'
                      : `${dt.day} · ${dt.time}`}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 2 }}>
                {formatTimestamp(r.startTime)} {'→'} {formatTimestamp(r.currentTime)}
              </div>
              {chapterLabel && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {chapterLabel}
                </div>
              )}
            </div>
            <Icon name="replay" style={{ color: 'var(--text-muted)', fontSize: 20 }} />
          </button>
        )
      })}
    </div>
  )
}
