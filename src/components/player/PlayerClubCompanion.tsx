import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HSClubDetail, HSNote, NoteReactionKind } from '@hearthshelf/core'
import { formatTimestamp } from '@hearthshelf/core'
import { clubsKeys } from '@/api/absClubs'
import { createNote, reactToNote } from '@/api/absNotes'
import type { AbsTarget } from '@/api/absLibrary'
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
  onClose,
  onOpenClub,
  onToast,
}: {
  target: AbsTarget
  detail: HSClubDetail
  libraryItemId: string
  position: number
  onClose: () => void
  onOpenClub: () => void
  onToast: (message: string) => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<MentionCandidate[]>([])
  const [safe, setSafe] = useState(true)
  const detailKey = clubsKeys.detail(target.serverId, detail.club.id, libraryItemId)
  const members = detail.members.map(({ userId, username }) => ({ userId, username }))

  const notes = useMemo(
    () =>
      detail.notes.notes
        .filter((note) => !note.parentId && note.timeSec != null)
        .sort(
          (a, b) => Math.abs((a.timeSec ?? 0) - position) - Math.abs((b.timeSec ?? 0) - position),
        ),
    [detail.notes.notes, position],
  )
  const nearby = notes[0]
  const discussion = notes.slice(1, 4)
  const nextLocked = detail.notes.locked
    .filter((stub) => stub.timeSec > position)
    .sort((a, b) => a.timeSec - b.timeSec)[0]

  const post = useMutation({
    mutationFn: () =>
      createNote(target, {
        libraryItemId,
        clubId: detail.club.id,
        visibility: 'club',
        timeSec: Math.max(0, Math.floor(position)),
        safe,
        body: draft.trim(),
        mentions: pickedMentions(draft, mentions),
      }),
    onSuccess: () => {
      setDraft('')
      setMentions([])
      void qc.invalidateQueries({ queryKey: detailKey })
      onToast('Comment added at your current spot')
    },
    onError: () => onToast('Could not post that comment. Try again.'),
  })
  const react = useMutation({
    mutationFn: ({ note, kind, on }: { note: HSNote; kind: NoteReactionKind; on: boolean }) =>
      reactToNote(target, note.id, kind, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: detailKey }),
    onError: () => onToast('Could not save that reaction.'),
  })

  const renderNote = (note: HSNote, featured = false) => (
    <article className={'pc-note' + (featured ? ' featured' : '')} key={note.id}>
      <Avatar
        name={note.username || 'Reader'}
        target={target}
        userId={note.userId}
        size={featured ? 34 : 28}
      />
      <div className="pc-note-body">
        <div className="pc-note-meta">
          <strong>{note.username || 'Reader'}</strong>
          {note.timeSec != null && <span>{formatTimestamp(note.timeSec)}</span>}
        </div>
        <p>{note.body}</p>
        <ReactionBar
          note={note}
          onReact={(item, kind, on) => react.mutate({ note: item, kind, on })}
        />
      </div>
    </article>
  )

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
              <span>Nearby comment</span>
              <span>
                {nearby.timeSec != null ? formatTimestamp(Math.abs(nearby.timeSec - position)) : ''}{' '}
                away
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
          if (draft.trim()) post.mutate()
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
