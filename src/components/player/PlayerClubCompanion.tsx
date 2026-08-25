import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HSClubDetail, HSNote, NoteReactionKind } from '@hearthshelf/core'
import { formatTimestamp } from '@hearthshelf/core'
import { clubsKeys } from '@/api/absClubs'
import { createNote, deleteNote, reactToNote, updateNote } from '@/api/absNotes'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { MentionInput, type MentionCandidate } from '@/components/social/MentionInput'
import { ReactionBar } from '@/components/social/ReactionBar'

function pickedMentions(body: string, picked: MentionCandidate[]): string[] {
  const text = body.toLowerCase()
  return picked
    .filter((member) => member.username && text.includes(`@${member.username.toLowerCase()}`))
    .map((member) => member.userId)
    .filter((id, index, ids) => ids.indexOf(id) === index)
}

function progressOf(currentTime: number | null, duration: number | null, finished: boolean | null) {
  if (finished) return 1
  if (currentTime == null || duration == null || duration <= 0) return 0
  return Math.max(0, Math.min(1, currentTime / duration))
}

export function PlayerClubCompanion({
  target,
  detail,
  libraryItemId,
  position,
  focusNoteId,
  onSeek,
  onClose,
  onOpenClub,
  onToast,
}: {
  target: AbsTarget
  detail: HSClubDetail
  libraryItemId: string
  position: number
  focusNoteId: string | null
  onSeek: (position: number) => void
  onClose: () => void
  onOpenClub: () => void
  onToast: (message: string) => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<MentionCandidate[]>([])
  const [safe, setSafe] = useState(true)
  const [replyingTo, setReplyingTo] = useState<HSNote | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyMentions, setReplyMentions] = useState<MentionCandidate[]>([])
  const [editing, setEditing] = useState<HSNote | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editSpoiler, setEditSpoiler] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const detailKey = clubsKeys.detail(target.serverId, detail.club.id, libraryItemId)
  const members = detail.members.map(({ userId, username }) => ({ userId, username }))

  const { data: me } = useQuery({
    queryKey: ['abs-me', target.serverId],
    queryFn: () => getMe(target),
    staleTime: 10 * 60 * 1000,
  })
  const meId = me?.id
  const isOwner = detail.club.createdBy === meId

  const topNotes = useMemo(
    () =>
      detail.notes.notes
        .filter((note) => !note.parentId && note.timeSec != null)
        .sort(
          (a, b) => Math.abs((a.timeSec ?? 0) - position) - Math.abs((b.timeSec ?? 0) - position),
        ),
    [detail.notes.notes, position],
  )
  const repliesByParent = useMemo(() => {
    const grouped = new Map<string, HSNote[]>()
    for (const note of detail.notes.notes) {
      if (!note.parentId) continue
      const replies = grouped.get(note.parentId) ?? []
      replies.push(note)
      grouped.set(note.parentId, replies)
    }
    return grouped
  }, [detail.notes.notes])
  const focused = focusNoteId
    ? detail.notes.notes.find((note) => note.id === focusNoteId)
    : undefined
  const focusedTopId = focused?.parentId || focused?.id
  const nearby = topNotes.find((note) => note.id === focusedTopId) ?? topNotes[0]
  const discussion = topNotes.filter((note) => note.id !== nearby?.id)
  const nextLocked = detail.notes.locked
    .filter((stub) => stub.timeSec > position)
    .sort((a, b) => a.timeSec - b.timeSec)[0]

  useEffect(() => {
    if (!focusNoteId) return
    const timer = window.setTimeout(() => {
      document
        .getElementById(`player-club-note-${focusNoteId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusNoteId, detail.notes.notes.length])

  const refresh = () => void qc.invalidateQueries({ queryKey: detailKey })
  const post = useMutation({
    mutationFn: (input: { body: string; parentId?: string; picked: MentionCandidate[] }) =>
      createNote(target, {
        libraryItemId,
        clubId: detail.club.id,
        visibility: 'club',
        parentId: input.parentId,
        timeSec: input.parentId ? undefined : Math.max(0, Math.floor(position)),
        safe: input.parentId ? false : safe,
        body: input.body,
        mentions: pickedMentions(input.body, input.picked),
      }),
    onSuccess: (_, input) => {
      if (input.parentId) {
        setReplyingTo(null)
        setReplyDraft('')
        setReplyMentions([])
        onToast('Reply added')
      } else {
        setDraft('')
        setMentions([])
        onToast('Comment added at your current spot')
      }
      refresh()
    },
    onError: () => onToast('Could not post that comment. Try again.'),
  })
  const react = useMutation({
    mutationFn: ({ note, kind, on }: { note: HSNote; kind: NoteReactionKind; on: boolean }) =>
      reactToNote(target, note.id, kind, on),
    onSuccess: refresh,
    onError: () => onToast('Could not save that reaction.'),
  })
  const edit = useMutation({
    mutationFn: ({ note, body, spoiler }: { note: HSNote; body: string; spoiler: boolean }) =>
      updateNote(target, note.id, { body, spoiler, timeSec: note.timeSec }),
    onSuccess: () => {
      setEditing(null)
      setEditDraft('')
      refresh()
      onToast('Comment updated')
    },
    onError: () => onToast('Could not update that comment.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteNote(target, id),
    onSuccess: () => {
      setConfirmDeleteId(null)
      refresh()
      onToast('Comment deleted')
    },
    onError: () => onToast('Could not delete that comment.'),
  })

  const beginEdit = (note: HSNote) => {
    setEditing(note)
    setEditDraft(note.body)
    setEditSpoiler(note.spoiler)
    setReplyingTo(null)
  }
  const jumpTo = (note: HSNote, rewind: number) => {
    if (note.timeSec == null) return
    onSeek(Math.max(0, note.timeSec - rewind))
    onToast(rewind ? 'Jumped to one minute before the comment' : 'Jumped to the comment')
  }

  const renderNote = (note: HSNote, featured = false, reply = false) => {
    const canEdit = note.userId === meId && (isOwner || detail.club.allowCommentEditing)
    const canDelete = note.userId === meId || isOwner
    const replies = reply ? [] : (repliesByParent.get(note.id) ?? [])
    return (
      <article
        className={
          'pc-note' +
          (featured ? ' featured' : '') +
          (reply ? ' reply' : '') +
          (focusNoteId === note.id ? ' focused' : '')
        }
        id={`player-club-note-${note.id}`}
        key={note.id}
      >
        <Avatar
          name={note.username || 'Reader'}
          target={target}
          userId={note.userId}
          size={featured ? 34 : reply ? 24 : 28}
        />
        <div className="pc-note-body">
          <div className="pc-note-meta">
            <strong>{note.username || 'Reader'}</strong>
            {note.updatedAt && <span>Edited</span>}
          </div>

          {editing?.id === note.id ? (
            <div className="pc-edit-form">
              <textarea
                className="fld"
                rows={3}
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                autoFocus
              />
              <div className="pc-inline-actions">
                <label className="pc-safe">
                  <input
                    type="checkbox"
                    checked={editSpoiler}
                    onChange={(event) => setEditSpoiler(event.target.checked)}
                  />{' '}
                  Spoiler
                </label>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!editDraft.trim() || edit.isPending}
                  onClick={() =>
                    edit.mutate({ note, body: editDraft.trim(), spoiler: editSpoiler })
                  }
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className={note.spoiler ? 'spoiler' : ''}>{note.body}</p>
              <div className="pc-note-actions">
                {note.timeSec != null && (
                  <details className="pc-time-menu">
                    <summary>
                      <Icon name="play_arrow" fill /> {formatTimestamp(note.timeSec)}
                    </summary>
                    <div>
                      <button type="button" onClick={() => jumpTo(note, 0)}>
                        <Icon name="play_arrow" fill /> Play from here
                      </button>
                      <button type="button" onClick={() => jumpTo(note, 60)}>
                        <Icon name="replay_60" /> One minute before
                      </button>
                    </div>
                  </details>
                )}
                <ReactionBar
                  note={note}
                  onReact={(item, kind, on) => react.mutate({ note: item, kind, on })}
                />
                {!reply && detail.club.allowReplies && (
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(note)
                      setEditing(null)
                    }}
                  >
                    Reply
                  </button>
                )}
                {canEdit && (
                  <button type="button" onClick={() => beginEdit(note)}>
                    Edit
                  </button>
                )}
                {canDelete &&
                  (confirmDeleteId === note.id ? (
                    <span className="pc-delete-confirm">
                      <button type="button" onClick={() => remove.mutate(note.id)}>
                        Delete?
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => setConfirmDeleteId(note.id)}
                    >
                      Delete
                    </button>
                  ))}
              </div>
            </>
          )}

          {replies.length > 0 && (
            <div className="pc-replies">{replies.map((item) => renderNote(item, false, true))}</div>
          )}
          {replyingTo?.id === note.id && (
            <form
              className="pc-reply-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (replyDraft.trim())
                  post.mutate({ body: replyDraft.trim(), parentId: note.id, picked: replyMentions })
              }}
            >
              <div className="pc-reply-label">Reply to {note.username}</div>
              <MentionInput
                value={replyDraft}
                onChange={setReplyDraft}
                onMention={(member) =>
                  setReplyMentions((current) =>
                    current.some((item) => item.userId === member.userId)
                      ? current
                      : [...current, member],
                  )
                }
                members={members}
                target={target}
                meId={meId}
                placeholder="Write a reply…"
                rows={2}
                autoFocus
              />
              <div className="pc-inline-actions">
                <button type="button" onClick={() => setReplyingTo(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!replyDraft.trim() || post.isPending}
                >
                  Reply
                </button>
              </div>
            </form>
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="pp-inner player-club-companion">
      <div className="pp-head pc-head">
        <Icon name="groups" />
        <div className="pp-htext">
          <div className="eyebrow">Book club</div>
          <button className="pc-club-link" onClick={onOpenClub}>
            {detail.club.name}
          </button>
          <div className="pp-sub">{detail.members.length} reading together</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close Book Club panel">
          <Icon name="close" />
        </button>
      </div>

      <div className="pc-scroll pp-scroll">
        <section className="pc-race" aria-label="Club reading progress">
          <div className="pc-section-label">
            <span>Reading together</span>
            <span>Finished</span>
          </div>
          <div className="pc-race-line">
            {detail.members.map((member) => {
              const progress = progressOf(member.currentTime, member.duration, member.isFinished)
              return (
                <span
                  className={'pc-racer' + (member.listeningNow ? ' listening' : '')}
                  key={member.userId}
                  style={{ left: `${progress * 100}%` }}
                  title={`${member.username} · ${Math.round(progress * 100)}%`}
                >
                  <Avatar
                    name={member.username || 'Reader'}
                    target={target}
                    userId={member.userId}
                    size={28}
                  />
                </span>
              )
            })}
          </div>
        </section>

        {nearby ? (
          <section>
            <div className="pc-section-label">
              <span>{focusedTopId ? 'Selected comment' : 'Nearby comment'}</span>
              <span>
                {nearby.timeSec != null
                  ? `${formatTimestamp(Math.abs(nearby.timeSec - position))} away`
                  : ''}
              </span>
            </div>
            {renderNote(nearby, true)}
          </section>
        ) : nextLocked ? (
          <button
            className="pc-locked"
            onClick={() => onToast(`A comment unlocks at ${formatTimestamp(nextLocked.timeSec)}`)}
          >
            <Icon name="lock" />
            <span>
              <strong>A comment is ahead</strong>
              <small>Keep listening to reveal it safely.</small>
            </span>
            <span>{formatTimestamp(nextLocked.timeSec - position)}</span>
          </button>
        ) : (
          <div className="pc-empty">
            No comments near your spot yet. Start the conversation below.
          </div>
        )}

        {discussion.length > 0 && (
          <section>
            <div className="pc-section-label">
              <span>Discussion around your spot</span>
              <span>{discussion.length}</span>
            </div>
            <div className="pc-discussion">{discussion.map((note) => renderNote(note))}</div>
          </section>
        )}
      </div>

      <form
        className="pc-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim()) post.mutate({ body: draft.trim(), picked: mentions })
        }}
      >
        <MentionInput
          value={draft}
          onChange={setDraft}
          onMention={(member) =>
            setMentions((current) =>
              current.some((item) => item.userId === member.userId)
                ? current
                : [...current, member],
            )
          }
          members={members}
          target={target}
          meId={meId}
          placeholder={`Share a thought at ${formatTimestamp(position)}…`}
          rows={2}
        />
        <div className="pc-compose-actions">
          <label className="pc-safe">
            <input
              type="checkbox"
              checked={safe}
              onChange={(event) => setSafe(event.target.checked)}
            />{' '}
            Safe ahead
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!draft.trim() || post.isPending}
          >
            <Icon name="send" /> {post.isPending ? 'Posting…' : 'Comment here'}
          </button>
        </div>
      </form>
    </div>
  )
}
