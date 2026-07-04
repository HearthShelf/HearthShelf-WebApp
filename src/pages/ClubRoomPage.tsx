import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { getClubDetail, clubsKeys, markClubRead, leaveClub, kickMember, deleteClub } from '@/api/absClubs'
import { createNote, deleteNote } from '@/api/absNotes'
import { sortMembersByProgress, formatTimestamp, fmtSessDate } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import { useToast } from '@/hooks/useToast'

/**
 * A club's room: chat thread for the viewed book (defaults to current), member
 * progress race, and the book history. Minimal-viable Phase 5 surface - owner
 * moderation (kick/delete/advance) lives here too. Polls every 15s while open,
 * per docs/social.md's polling cadence (no realtime channel yet).
 */
export function ClubRoomPage() {
  const { clubId } = useParams()
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const { toast, show } = useToast()

  const [bookId, setBookId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [safe, setSafe] = useState(false)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })

  const key = clubsKeys.detail(target?.serverId ?? '', clubId ?? '', bookId ?? '')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => getClubDetail(target!, clubId as string, { bookId }),
    enabled: Boolean(target && clubId),
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
  })

  // Mark read once the room is open and notes have loaded.
  useEffect(() => {
    if (!target || !clubId || !data?.enabled) return
    const latest = data.notes.notes.reduce((max, n) => Math.max(max, n.createdAt), 0)
    if (latest > 0) void markClubRead(target, clubId, latest).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, clubId, data?.notes.notes.length])

  const post = useMutation({
    mutationFn: (body: string) =>
      createNote(target!, {
        libraryItemId: (bookId ?? data?.club.currentBook?.libraryItemId) as string,
        clubId: clubId as string,
        safe,
        body,
      }),
    onSuccess: () => {
      setDraft('')
      setSafe(false)
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: () => show('Could not post - try again'),
  })

  const remove = useMutation({
    mutationFn: (noteId: string) => deleteNote(target!, noteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: () => show('Could not delete that note'),
  })

  const leave = useMutation({
    mutationFn: () => leaveClub(target!, clubId as string),
    onSuccess: () => navigate('/library'),
    onError: () => show('Could not leave the club'),
  })

  const kick = useMutation({
    mutationFn: (userId: string) => kickMember(target!, clubId as string, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: () => show('Could not remove that member'),
  })

  const archive = useMutation({
    mutationFn: () => deleteClub(target!, clubId as string),
    onSuccess: () => navigate('/library'),
    onError: () => show('Could not archive the club'),
  })

  const sortedMembers = useMemo(
    () => (data ? sortMembersByProgress(data.members) : []),
    [data],
  )

  if (!target) {
    return (
      <div className="page">
        <ErrorState message="No active server." />
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading club..." />
      </div>
    )
  }
  if (isError || !data?.enabled) {
    return (
      <div className="page">
        <ErrorState message="Could not load this club." onRetry={() => void refetch()} />
      </div>
    )
  }

  const { club, books, notes } = data
  const isOwner = club.createdBy === me?.id
  const viewedBook =
    books.find((b) => b.libraryItemId === (bookId ?? club.currentBook?.libraryItemId)) ??
    club.currentBook
  const isCurrentBook = viewedBook?.libraryItemId === club.currentBook?.libraryItemId
  const pastBooks = books.filter((b) => b.finishedAt != null).sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Book Club</div>
        <h1 className="title-xl">{club.name}</h1>
        <p className="page-sub">
          {club.memberCount} {club.memberCount === 1 ? 'member' : 'members'}
        </p>
      </div>

      <div className="detail-actions" style={{ marginBottom: 'var(--s5)' }}>
        {!isOwner && (
          <button className="pill" disabled={leave.isPending} onClick={() => leave.mutate()}>
            <Icon name="logout" /> Leave club
          </button>
        )}
        {isOwner && (
          <button
            className="pill"
            disabled={archive.isPending}
            onClick={() => {
              if (window.confirm('Archive this club? This cannot be undone.')) archive.mutate()
            }}
          >
            <Icon name="archive" /> Archive club
          </button>
        )}
      </div>

      {viewedBook && (
        <div className="cfg-card" style={{ marginBottom: 'var(--s5)' }}>
          <div className="cfg-line">
            <Icon name="menu_book" style={{ color: 'var(--accent)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{viewedBook.title}</div>
              <div className="cl-d">
                by {viewedBook.author} · {isCurrentBook ? 'current book' : 'finished'}
              </div>
            </div>
            {!isCurrentBook && (
              <button className="pill" onClick={() => setBookId(club.currentBook?.libraryItemId)}>
                Back to current
              </button>
            )}
          </div>
        </div>
      )}

      {isCurrentBook && (
        <>
          <div className="section-head">
            <Icon name="social_leaderboard" />
            <h2>Reading progress</h2>
          </div>
          <div className="cfg-card" style={{ marginBottom: 'var(--s5)' }}>
            {sortedMembers.length === 0 ? (
              <div className="pop-empty">No members yet.</div>
            ) : (
              sortedMembers.map((m) => {
                const pct =
                  m.currentTime != null && m.duration != null && m.duration > 0
                    ? Math.min(1, m.currentTime / m.duration)
                    : 0
                return (
                  <div className="cfg-line" key={m.userId}>
                    <Avatar
                      name={m.username}
                      target={target}
                      userId={m.userId}
                      size={28}
                      className="hs-avatar"
                    />
                    <div className="cl-meta" style={{ flex: 1 }}>
                      <div className="cl-t">
                        {m.username}
                        {m.role === 'owner' && (
                          <span className="badge-pill abridged" style={{ marginLeft: 6 }}>
                            Owner
                          </span>
                        )}
                        {m.listeningNow && (
                          <Icon
                            name="podcasts"
                            style={{ fontSize: 13, marginLeft: 6, color: '#a7c896', verticalAlign: '-2px' }}
                          />
                        )}
                      </div>
                      <div className="prog-line" style={{ marginTop: 6, width: '100%' }}>
                        <i style={{ width: `${pct * 100}%` }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {m.isFinished ? 'Finished' : m.currentTime != null ? `${Math.round(pct * 100)}%` : '—'}
                    </span>
                    {isOwner && m.role !== 'owner' && (
                      <button
                        className="tbl-icon"
                        title="Kick"
                        onClick={() => {
                          if (window.confirm(`Remove ${m.username} from the club?`)) kick.mutate(m.userId)
                        }}
                      >
                        <Icon name="person_remove" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}

      <div className="section-head">
        <Icon name="forum" />
        <h2>Chat</h2>
      </div>

      {isCurrentBook && (
        <div className="cfg-card" style={{ marginBottom: 10 }}>
          <textarea
            className="fld"
            rows={2}
            placeholder="Say something about this book..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8, gap: 8 }}>
            <button
              type="button"
              className={'pill' + (safe ? ' on' : '')}
              onClick={() => setSafe(!safe)}
              title="Safe - show to everyone now (no spoilers)"
            >
              <Icon name="shield" /> Safe
            </button>
            <button className="pill on" disabled={!draft.trim() || post.isPending} onClick={() => post.mutate(draft.trim())}>
              <Icon name="send" /> Post
            </button>
          </div>
        </div>
      )}

      {notes.notes.length === 0 ? (
        <div className="pop-empty">No chat yet for this book.</div>
      ) : (
        <div className="bm-list">
          {[...notes.notes]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((n) => {
              const { day, time } = fmtSessDate(n.createdAt)
              const mine = n.userId === me?.id
              return (
                <div className="bm-row" key={n.id} style={{ alignItems: 'flex-start', gap: 10 }}>
                  <Avatar
                    name={n.username}
                    target={target}
                    userId={n.userId}
                    size={28}
                    className="hs-avatar"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span className="bm-n" style={{ fontWeight: 600 }}>
                        {n.username}
                      </span>
                      {n.safe && (
                        <span className="badge-pill abridged" title="Marked spoiler-free - shown to everyone early">
                          Safe
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {day} · {time}
                        {n.timeSec != null && <> · {formatTimestamp(n.timeSec)}</>}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                    {(mine || isOwner) && (
                      <button
                        className="read-more"
                        style={{ fontSize: 12, color: 'var(--primary)', marginTop: 4 }}
                        onClick={() => remove.mutate(n.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {notes.hiddenAhead > 0 && (
        <div className="banner info" style={{ marginTop: 'var(--s3)' }}>
          <Icon name="visibility_off" />
          {notes.hiddenAhead} {notes.hiddenAhead === 1 ? 'note is' : 'notes are'} hidden ahead of
          your position, to avoid spoilers.
        </div>
      )}

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="history" />
        <h2>Book history</h2>
      </div>
      <div className="cfg-card">
        {club.currentBook && (
          <div className="cfg-line">
            <Icon name="menu_book" style={{ color: 'var(--accent)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{club.currentBook.title}</div>
              <div className="cl-d">by {club.currentBook.author} · current book</div>
            </div>
            <button className="pill" onClick={() => setBookId(club.currentBook?.libraryItemId)}>
              View chat
            </button>
          </div>
        )}
        {pastBooks.length === 0 && !club.currentBook ? (
          <div className="pop-empty">No books yet.</div>
        ) : (
          pastBooks.map((b) => (
            <div className="cfg-line" key={b.libraryItemId}>
              <Icon name="menu_book" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">{b.title}</div>
                <div className="cl-d">by {b.author} · finished</div>
              </div>
              <button className="pill" onClick={() => setBookId(b.libraryItemId)}>
                View chat
              </button>
            </div>
          ))
        )}
      </div>

      {isOwner && club.currentBook && (
        <div className="banner info" style={{ marginTop: 'var(--s4)' }}>
          <Icon name="info" />
          To move this club to a new book, open that book's page and use the Book Club card there
          - advancing archives the current book's chat (still readable in history).
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
