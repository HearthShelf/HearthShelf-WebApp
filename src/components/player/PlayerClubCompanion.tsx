import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HSClubDetail, HSClubMember, HSNote, NoteReactionKind } from '@hearthshelf/core'
import { formatTimestamp } from '@hearthshelf/core'
import { clubsKeys, setClubSettings } from '@/api/absClubs'
import { createNote, deleteNote, reactToNote, updateNote } from '@/api/absNotes'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { Cover } from '@/components/shared/Cover'
import { MentionInput, type MentionCandidate } from '@/components/social/MentionInput'
import { ReactionBar } from '@/components/social/ReactionBar'
import {
  CommentVisibilityControl,
  SpoilerToggle,
} from '@/components/social/CommentComposerControls'
import { SetRow, Toggle } from '@/components/settings/controls'

type ClubTab = 'comments' | 'queue' | 'members'

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

function memberProgress(
  member: HSClubMember,
  meId: string | undefined,
  livePosition: number,
  liveDuration: number,
) {
  return progressOf(
    member.userId === meId ? livePosition : member.currentTime,
    member.userId === meId && liveDuration > 0 ? liveDuration : member.duration,
    member.isFinished,
  )
}

export function PlayerClubCompanion({
  target,
  detail,
  libraryItemId,
  position,
  duration,
  focusNoteId,
  onSeek,
  onClose,
  onOpenClub,
  onOpenBook,
  onToast,
}: {
  target: AbsTarget
  detail: HSClubDetail
  libraryItemId: string
  position: number
  duration: number
  focusNoteId: string | null
  onSeek: (position: number) => void
  onClose: () => void
  onOpenClub: () => void
  onOpenBook: (libraryItemId: string) => void
  onToast: (message: string) => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<MentionCandidate[]>([])
  const [safe, setSafe] = useState(false)
  const [draftSpoiler, setDraftSpoiler] = useState(false)
  const [replyingTo, setReplyingTo] = useState<HSNote | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replySpoiler, setReplySpoiler] = useState(false)
  const [replyMentions, setReplyMentions] = useState<MentionCandidate[]>([])
  const [editing, setEditing] = useState<HSNote | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editSpoiler, setEditSpoiler] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [tab, setTab] = useState<ClubTab>('comments')
  const [progressExpanded, setProgressExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [allowEditing, setAllowEditing] = useState(detail.club.allowCommentEditing)
  const [allowReplies, setAllowReplies] = useState(detail.club.allowReplies)
  const [autoAdvance, setAutoAdvance] = useState(detail.club.autoAdvanceOnAllFinished)
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
        .filter((note) => !note.parentId)
        .sort((a, b) => {
          const aDistance =
            a.timeSec == null ? Number.POSITIVE_INFINITY : Math.abs(a.timeSec - position)
          const bDistance =
            b.timeSec == null ? Number.POSITIVE_INFINITY : Math.abs(b.timeSec - position)
          return aDistance === bDistance ? a.createdAt - b.createdAt : aDistance - bDistance
        }),
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
    setTab('comments')
    const timer = window.setTimeout(() => {
      document
        .getElementById(`player-club-note-${focusNoteId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusNoteId, detail.notes.notes.length])

  const refresh = () => void qc.invalidateQueries({ queryKey: detailKey })
  const post = useMutation({
    mutationFn: (input: {
      body: string
      parentId?: string
      picked: MentionCandidate[]
      spoiler: boolean
    }) =>
      createNote(target, {
        libraryItemId,
        clubId: detail.club.id,
        visibility: 'club',
        parentId: input.parentId,
        timeSec: input.parentId ? undefined : Math.max(0, Math.floor(position)),
        safe: input.parentId ? false : safe,
        spoiler: input.spoiler,
        body: input.body,
        mentions: pickedMentions(input.body, input.picked),
      }),
    onSuccess: (_, input) => {
      if (input.parentId) {
        setReplyingTo(null)
        setReplyDraft('')
        setReplyMentions([])
        setReplySpoiler(false)
        onToast('Reply added')
      } else {
        setDraft('')
        setMentions([])
        setDraftSpoiler(false)
        setSafe(false)
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
  const saveSettings = useMutation({
    mutationFn: () =>
      setClubSettings(target, detail.club.id, {
        allowCommentEditing: allowEditing,
        allowReplies,
        autoAdvanceOnAllFinished: autoAdvance,
      }),
    onSuccess: () => {
      setSettingsOpen(false)
      refresh()
      onToast('Club settings saved')
    },
    onError: () => onToast('Could not save club settings.'),
  })

  const openSettings = () => {
    setAllowEditing(detail.club.allowCommentEditing)
    setAllowReplies(detail.club.allowReplies)
    setAutoAdvance(detail.club.autoAdvanceOnAllFinished)
    setSettingsOpen(true)
  }

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

  const progressRows = [...detail.members].sort(
    (a, b) =>
      memberProgress(b, meId, position, duration) - memberProgress(a, meId, position, duration),
  )

  const renderMemberProgress = (member: HSClubMember, detailed = false) => {
    const progress = memberProgress(member, meId, position, duration)
    const percent = Math.round(progress * 100)
    return (
      <div className={'pc-member-progress' + (detailed ? ' detailed' : '')} key={member.userId}>
        <Avatar
          name={member.username || 'Reader'}
          target={target}
          userId={member.userId}
          size={detailed ? 34 : 28}
        />
        <div className="pc-member-progress-copy">
          <div>
            <strong>{member.username || 'Reader'}</strong>
            <span>{member.isFinished ? 'Finished' : `${percent}%`}</span>
          </div>
          <div className="pc-member-progress-track" aria-label={`${percent}% complete`}>
            <i style={{ width: `${percent}%` }} />
          </div>
          {detailed && (
            <small>
              {member.role === 'owner' ? 'Club owner' : 'Member'}
              {member.listeningNow ? ' · Listening now' : ''}
              {member.reach?.aheadOfClub ? ` · Reading ahead in ${member.reach.title}` : ''}
            </small>
          )}
        </div>
      </div>
    )
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
                <SpoilerToggle on={editSpoiler} onChange={setEditSpoiler} compact />
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
                      setReplyDraft('')
                      setReplyMentions([])
                      setReplySpoiler(false)
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
                  post.mutate({
                    body: replyDraft.trim(),
                    parentId: note.id,
                    picked: replyMentions,
                    spoiler: replySpoiler,
                  })
              }}
            >
              <div className="pc-reply-label">Replying to {note.username}</div>
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
                placeholder={`Reply to ${note.username}…`}
                rows={2}
                autoFocus
              />
              <div className="pc-inline-actions">
                <SpoilerToggle on={replySpoiler} onChange={setReplySpoiler} compact />
                <button
                  type="button"
                  onClick={() => {
                    setReplyingTo(null)
                    setReplyDraft('')
                    setReplyMentions([])
                    setReplySpoiler(false)
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!replyDraft.trim() || post.isPending}
                >
                  {post.isPending ? 'Posting…' : 'Post reply'}
                </button>
              </div>
            </form>
          )}
        </div>
      </article>
    )
  }

  return (
    <>
      <div className="pp-inner player-club-companion">
        <div className="pp-head pc-head">
          <Icon name="groups" />
          <div className="pp-htext">
            <div className="eyebrow">Book club</div>
            <strong className="pc-club-name">{detail.club.name}</strong>
            <div className="pp-sub">{detail.members.length} reading together</div>
          </div>
          <div className="pc-head-actions">
            {isOwner && (
              <button
                className="icon-btn"
                onClick={openSettings}
                aria-label="Club settings"
                title="Club settings"
              >
                <Icon name="settings" />
              </button>
            )}
            <button
              className="icon-btn"
              onClick={onOpenClub}
              aria-label="Open full club page"
              title="Open full club page"
            >
              <Icon name="open_in_new" />
            </button>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close Book Club panel"
              title="Close"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className={'pc-race' + (progressExpanded ? ' expanded' : '')}
          onClick={() => setProgressExpanded((value) => !value)}
          aria-expanded={progressExpanded}
        >
          <div className="pc-section-label">
            <span>Overall book progress</span>
            <span>{progressExpanded ? 'Hide details' : 'Show everyone'}</span>
          </div>
          <div className="pc-race-line">
            <i
              className="pc-race-fill"
              style={{
                width: `${Math.round(progressOf(position, duration, false) * 100)}%`,
              }}
            />
            {progressRows.map((member) => {
              const progress = memberProgress(member, meId, position, duration)
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
          <div className="pc-race-footer">
            <span>{detail.members.length} readers</span>
            <Icon name={progressExpanded ? 'expand_less' : 'expand_more'} />
          </div>
        </button>

        {progressExpanded && (
          <div className="pc-progress-roster">
            {progressRows.map((member) => renderMemberProgress(member))}
          </div>
        )}

        <div className="pc-tabs" role="tablist" aria-label="Book Club sections">
          {(
            [
              ['comments', 'forum', 'Comments', topNotes.length + detail.notes.locked.length],
              ['queue', 'format_list_numbered', 'Queue', detail.queue.length],
              ['members', 'group', 'Members', detail.members.length],
            ] as const
          ).map(([value, icon, label, count]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'on' : ''}
              key={value}
              onClick={() => setTab(value)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>

        <div className="pc-scroll pp-scroll">
          {tab === 'comments' && (
            <>
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
                  onClick={() =>
                    onToast(`A comment unlocks at ${formatTimestamp(nextLocked.timeSec)}`)
                  }
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
            </>
          )}

          {tab === 'queue' && (
            <section className="pc-tab-section">
              <div className="pc-section-label">
                <span>Up next</span>
                <span>{detail.queue.length}</span>
              </div>
              {detail.queue.length === 0 ? (
                <div className="pc-empty">Nothing is lined up after this book.</div>
              ) : (
                <div className="pc-queue-list">
                  {detail.queue.map((book, index) => (
                    <button
                      type="button"
                      className="pc-queue-row"
                      key={book.libraryItemId}
                      onClick={() => onOpenBook(book.libraryItemId)}
                    >
                      <span className="pc-queue-order">{index + 1}</span>
                      <Cover
                        itemId={book.libraryItemId}
                        title={book.title}
                        author={book.author}
                        width={48}
                        fs={5}
                      />
                      <span className="pc-queue-copy">
                        <strong>{book.title || 'Untitled'}</strong>
                        <small>{book.author || 'Unknown author'}</small>
                      </span>
                      <Icon name="chevron_right" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'members' && (
            <section className="pc-tab-section">
              <div className="pc-section-label">
                <span>Club members</span>
                <span>{detail.members.length}</span>
              </div>
              <div className="pc-members-list">
                {progressRows.map((member) => renderMemberProgress(member, true))}
              </div>
            </section>
          )}
        </div>

        {tab === 'comments' && (
          <form
            className="pc-composer"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim())
                post.mutate({
                  body: draft.trim(),
                  picked: mentions,
                  spoiler: draftSpoiler,
                })
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
              placeholder="Start a new thread…"
              rows={2}
            />
            <div className="pc-compose-context">
              <Icon name="schedule" /> Comment at {formatTimestamp(position)}
            </div>
            <div className="pc-compose-options">
              <SpoilerToggle on={draftSpoiler} onChange={setDraftSpoiler} compact />
              <CommentVisibilityControl visibleAhead={safe} onChange={setSafe} compact />
            </div>
            <div className="pc-compose-actions">
              <span />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!draft.trim() || post.isPending}
              >
                <Icon name="send" /> {post.isPending ? 'Posting…' : 'Post comment'}
              </button>
            </div>
          </form>
        )}
      </div>

      {settingsOpen && (
        <Modal
          title="Club settings"
          onClose={() => setSettingsOpen(false)}
          foot={
            <>
              <button className="pill" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saveSettings.isPending}
                onClick={() => saveSettings.mutate()}
              >
                {saveSettings.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="pc-settings">
            <p>{detail.club.name}</p>
            <SetRow
              title="Allow member comment editing"
              desc="Members can revise their own text and spoiler flag."
              control={<Toggle on={allowEditing} onChange={setAllowEditing} />}
            />
            <SetRow
              title="Allow replies"
              desc="Members can reply to existing top-level comments."
              control={<Toggle on={allowReplies} onChange={setAllowReplies} />}
            />
            <SetRow
              title="Move on when everyone has finished"
              desc="Start the first queued book after every reader who began this one finishes."
              control={<Toggle on={autoAdvance} onChange={setAutoAdvance} />}
            />
          </div>
        </Modal>
      )}
    </>
  )
}
