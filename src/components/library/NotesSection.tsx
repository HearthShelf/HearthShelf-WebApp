import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNotes, createNote, deleteNote, notesKeys } from '@/api/absNotes'
import { formatTimestamp, fmtSessDate } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSNote } from '@hearthshelf/core'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

/**
 * Public notes for a book (Phase 4). Server-side spoiler gated by `position` -
 * ahead-notes never reach the wire as full bodies, only a `hiddenAhead` count.
 * One level of replies; delete own note (soft delete keeps the thread intact).
 * Degrades to nothing rendered when the server has notes disabled/unavailable.
 */
export function NotesSection({
  target,
  libraryItemId,
  meId,
  position,
  finished,
}: {
  target: AbsTarget
  libraryItemId: string
  meId: string
  position: number
  finished: boolean
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const key = notesKeys.list(target.serverId, libraryItemId, '')
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getNotes(target, libraryItemId, { position, finished }),
    staleTime: 30 * 1000,
  })

  const post = useMutation({
    mutationFn: (body: string) => createNote(target, { libraryItemId, body }),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: key })
    },
  })

  const postReply = useMutation({
    mutationFn: (vars: { parentId: string; body: string }) =>
      createNote(target, { libraryItemId, parentId: vars.parentId, body: vars.body }),
    onSuccess: () => {
      setReplyDraft('')
      setReplyTo(null)
      void qc.invalidateQueries({ queryKey: key })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteNote(target, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })

  // Top-level notes + their one level of replies, newest top-level first.
  const threads = useMemo(() => {
    const notes = data?.notes ?? []
    const topLevel = notes.filter((n) => n.parentId === '').sort((a, b) => b.createdAt - a.createdAt)
    const repliesByParent = new Map<string, HSNote[]>()
    for (const n of notes) {
      if (n.parentId === '') continue
      const list = repliesByParent.get(n.parentId) ?? []
      list.push(n)
      repliesByParent.set(n.parentId, list)
    }
    for (const list of repliesByParent.values()) list.sort((a, b) => a.createdAt - b.createdAt)
    return topLevel.map((n) => ({ note: n, replies: repliesByParent.get(n.id) ?? [] }))
  }, [data])

  if (!data?.enabled) return null

  return (
    <div className="detail-section">
      <div className="section-head">
        <Icon name="sticky_note_2" />
        <h2>Notes</h2>
      </div>

      <div className="cfg-card" style={{ marginBottom: 'var(--s4)' }}>
        <textarea
          className="fld"
          rows={2}
          placeholder="Share a thought about this book..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            className="pill on"
            disabled={!draft.trim() || post.isPending}
            onClick={() => post.mutate(draft.trim())}
          >
            <Icon name="send" /> Post
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner className="py-6" label="Loading notes..." />
      ) : threads.length === 0 ? (
        <div className="pop-empty">No notes yet - be the first to share one.</div>
      ) : (
        <div className="bm-list">
          {threads.map(({ note, replies }) => (
            <NoteThread
              key={note.id}
              note={note}
              replies={replies}
              meId={meId}
              replyOpen={replyTo === note.id}
              replyDraft={replyDraft}
              onSetReplyDraft={setReplyDraft}
              onToggleReply={() => {
                setReplyTo(replyTo === note.id ? null : note.id)
                setReplyDraft('')
              }}
              onSubmitReply={() => {
                if (!replyDraft.trim()) return
                postReply.mutate({ parentId: note.id, body: replyDraft.trim() })
              }}
              onDelete={(id) => remove.mutate(id)}
            />
          ))}
        </div>
      )}

      {(data.hiddenAhead ?? 0) > 0 && (
        <div className="banner info" style={{ marginTop: 'var(--s3)' }}>
          <Icon name="visibility_off" />
          {data.hiddenAhead} {data.hiddenAhead === 1 ? 'note is' : 'notes are'} hidden ahead of
          your position, to avoid spoilers.
        </div>
      )}
    </div>
  )
}

function NoteLine({
  note,
  meId,
  onDelete,
  onReply,
}: {
  note: HSNote
  meId: string
  onDelete?: (id: string) => void
  onReply?: () => void
}) {
  const { day, time } = fmtSessDate(note.createdAt)
  const mine = note.userId === meId
  return (
    <div className="bm-row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <Avatar name={note.username} size={28} className="hs-avatar" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="bm-n" style={{ fontWeight: 600 }}>
            {note.username}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {day} · {time}
            {note.timeSec != null && <> · {formatTimestamp(note.timeSec)}</>}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{note.body}</div>
        <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
          {onReply && (
            <button className="read-more" onClick={onReply} style={{ fontSize: 12 }}>
              Reply
            </button>
          )}
          {mine && onDelete && (
            <button
              className="read-more"
              onClick={() => onDelete(note.id)}
              style={{ fontSize: 12, color: 'var(--primary)' }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function NoteThread({
  note,
  replies,
  meId,
  replyOpen,
  replyDraft,
  onSetReplyDraft,
  onToggleReply,
  onSubmitReply,
  onDelete,
}: {
  note: HSNote
  replies: HSNote[]
  meId: string
  replyOpen: boolean
  replyDraft: string
  onSetReplyDraft: (v: string) => void
  onToggleReply: () => void
  onSubmitReply: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 10 }}>
      <NoteLine note={note} meId={meId} onDelete={onDelete} onReply={onToggleReply} />
      {replies.length > 0 && (
        <div style={{ marginLeft: 38, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {replies.map((r) => (
            <NoteLine key={r.id} note={r} meId={meId} onDelete={onDelete} />
          ))}
        </div>
      )}
      {replyOpen && (
        <div style={{ marginLeft: 38, marginTop: 8 }}>
          <textarea
            className="fld"
            rows={2}
            placeholder={`Reply to ${note.username}...`}
            value={replyDraft}
            onChange={(e) => onSetReplyDraft(e.target.value)}
            maxLength={2000}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="pill on" disabled={!replyDraft.trim()} onClick={onSubmitReply}>
              <Icon name="send" /> Reply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
