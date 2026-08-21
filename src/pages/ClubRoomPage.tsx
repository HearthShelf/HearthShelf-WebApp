import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { HSClub, HSClubBook, HSClubDetail, HSClubMember, HSNote } from '@hearthshelf/core'
import { fmtSessDate, formatTimestamp, sortMembersByProgress } from '@hearthshelf/core'
import {
  advanceClubBook,
  archiveClub,
  clubsKeys,
  createClub,
  deleteClub,
  getClubDetail,
  getClubInvitees,
  getClubs,
  inviteClubUsers,
  kickMember,
  leaveClub,
  markClubRead,
  removeQueuedClubBook,
  reorderClubQueue,
  requeueClubBook,
  respondToClubInvite,
  revokeClubInvite,
  type ClubInvitee,
} from '@/api/absClubs'
import { createNote, deleteNote } from '@/api/absNotes'
import { MentionInput } from '@/components/social/MentionInput'
import type { MentionCandidate } from '@/components/social/MentionInput'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { Avatar } from '@/components/common/Avatar'
import { ErrorState } from '@/components/common/ErrorState'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Cover } from '@/components/shared/Cover'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { AddClubBooksDialog } from '@/components/social/AddClubBooksDialog'
import { ClubBookMenu } from '@/components/social/ClubBookMenu'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useToast } from '@/hooks/useToast'
import { usePlayer } from '@/player/PlayerProvider'

/**
 * The mentions still present in the text at post time, as user ids.
 *
 * Picking a name then deleting the "@name" should un-mention them, so the
 * selection list is filtered against the final body. Matching is by the exact
 * "@username" the picker inserted, which is why usernames with spaces still
 * work here where a token regex would not.
 */
function pickedMentions(body: string, picked: MentionCandidate[]): string[] {
  const text = body.toLowerCase()
  const ids: string[] = []
  for (const member of picked) {
    if (!member.username) continue
    if (!text.includes(`@${member.username.toLowerCase()}`)) continue
    if (!ids.includes(member.userId)) ids.push(member.userId)
  }
  return ids
}

/** A username that opens that reader's profile. */
function UserLink({
  userId,
  username,
  className,
}: {
  userId: string
  username: string
  className?: string
}) {
  const navigate = useNavigate()
  if (!userId) return <>{username}</>
  return (
    <button
      type="button"
      className={'user-link' + (className ? ' ' + className : '')}
      title={`View ${username}'s profile`}
      onClick={(event) => {
        // These sit inside clickable rows (a note, a progress bar) - don't let
        // the parent's handler fire too.
        event.stopPropagation()
        navigate(`/user/${encodeURIComponent(userId)}`)
      }}
    >
      {username}
    </button>
  )
}

/** A note body with its @mentions highlighted and linked to the reader's
 *  profile. Splits on the exact usernames the server recorded rather than
 *  guessing at "@word", so a name with a space highlights as one mention. */
function NoteBody({ note, target }: { note: HSNote; target: AbsTarget }) {
  const navigate = useNavigate()
  const mentions = note.mentions ?? []
  if (!mentions.length) return <p>{note.body}</p>
  // Longest first so "@ann marie" wins over "@ann".
  const ordered = [...mentions]
    .filter((m) => m.username)
    .sort((a, b) => b.username.length - a.username.length)
  if (!ordered.length) return <p>{note.body}</p>
  const byName = new Map(ordered.map((m) => [m.username.toLowerCase(), m.userId]))
  const pattern = new RegExp(`@(?:${ordered.map((m) => escapeRegExp(m.username)).join('|')})`, 'gi')
  const parts: Array<string | { mention: string; userId: string }> = []
  let last = 0
  for (const match of note.body.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push(note.body.slice(last, at))
    parts.push({
      mention: match[0],
      userId: byName.get(match[0].slice(1).toLowerCase()) ?? '',
    })
    last = at + match[0].length
  }
  if (last < note.body.length) parts.push(note.body.slice(last))
  return (
    <p>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          <span key={index}>{part}</span>
        ) : part.userId ? (
          <button
            type="button"
            className="note-mention"
            key={index}
            title={`View ${part.mention.slice(1)}'s profile`}
            onClick={(event) => {
              event.stopPropagation()
              navigate(`/user/${encodeURIComponent(part.userId)}`)
            }}
          >
            {/* The photo stands in for the '@'. Avatar falls back to initials,
                so a reader with no photo still gets a legible marker. */}
            <Avatar
              name={part.mention.slice(1)}
              target={target}
              userId={part.userId}
              size={16}
              className="hs-avatar note-mention-avatar"
            />
            {part.mention.slice(1)}
          </button>
        ) : (
          <span className="note-mention" key={index}>
            {part.mention}
          </span>
        ),
      )}
    </p>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function progressOf(member: HSClubMember | undefined): number {
  if (!member) return 0
  if (member.isFinished) return 1
  if (member.currentTime == null || member.duration == null || member.duration <= 0) return 0
  return Math.max(0, Math.min(1, member.currentTime / member.duration))
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

// How many queued books the sidebar rail shows before "View all". A club
// working a long series can have a dozen queued, which would swamp the column.
const QUEUE_PREVIEW = 4

// Member pins on the timeline: how tall a stacked row is (avatar + name +
// percentage), and how much of the bar two pins must be apart to share one.
const PIN_ROW_H = 58
const PIN_MIN_GAP = 0.12

function clubQueryPrefix(serverId: string): readonly unknown[] {
  return ['clubs', serverId]
}

function ClubMiniCard({
  club,
  target,
  meId,
  selected,
  onSelect,
}: {
  club: HSClub
  target: AbsTarget
  meId: string | undefined
  selected: boolean
  onSelect: () => void
}) {
  const { data } = useQuery({
    queryKey: clubsKeys.detail(target.serverId, club.id, ''),
    queryFn: () => getClubDetail(target, club.id),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })
  const members = data?.members ?? []
  const mine = members.find((member) => member.userId === meId)
  const mineProgress = progressOf(mine)
  const maxProgress = members.reduce((max, member) => Math.max(max, progressOf(member)), 0)
  const everyoneFinished = members.length > 0 && members.every((member) => member.isFinished)
  const inLead = !everyoneFinished && mineProgress > 0 && mineProgress >= maxProgress

  return (
    <button
      type="button"
      className={'book-club-mini' + (selected ? ' selected' : '')}
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
    >
      {club.currentBook ? (
        <Cover
          itemId={club.currentBook.libraryItemId}
          title={club.currentBook.title}
          author={club.currentBook.author}
          width={100}
          fs={7}
          className="book-club-mini-cover"
        />
      ) : (
        <span className="book-club-mini-empty">
          <Icon name="menu_book" />
        </span>
      )}
      <span className="book-club-mini-body">
        <span className="book-club-mini-topline">
          <strong>{club.name}</strong>
          {(data?.unreadCount ?? 0) > 0 && <span className="ni-badge">{data?.unreadCount}</span>}
        </span>
        <span className="book-club-mini-book">
          {club.currentBook?.title ?? 'Choose the first book'}
        </span>
        <span className="book-club-mini-stats">
          {everyoneFinished ? (
            <span className="book-club-stat done">
              <Icon name="check_circle" fill /> Everyone finished
            </span>
          ) : (
            <>
              <span>{mine ? `${pct(mineProgress)} read` : `${club.memberCount} members`}</span>
              {inLead && (
                <span className="book-club-stat lead">
                  <Icon name="social_leaderboard" /> In the lead
                </span>
              )}
            </>
          )}
        </span>
        {members.length > 0 && (
          <span className="book-club-mini-members" aria-label={`${members.length} members`}>
            {members.slice(0, 4).map((member) => (
              <Avatar
                key={member.userId}
                name={member.username}
                target={target}
                userId={member.userId}
                size={22}
                className="hs-avatar"
              />
            ))}
            {members.length > 4 && <span>+{members.length - 4}</span>}
          </span>
        )}
      </span>
      <Icon name="chevron_right" className="book-club-mini-chevron" />
    </button>
  )
}

function NewClubForm({
  pending,
  onCancel,
  onCreate,
}: {
  pending: boolean
  onCancel?: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <form
      className="book-club-create"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onCreate(name.trim())
      }}
    >
      <div className="book-club-create-icon">
        <Icon name="groups_3" />
      </div>
      <div>
        <h2>Start a book club</h2>
        <p>Create the club now, then choose its first book from any book page.</p>
      </div>
      <input
        className="fld"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Club name"
        maxLength={120}
        autoFocus
      />
      <div className="book-club-create-actions">
        {onCancel && (
          <button type="button" className="pill" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="pill on" disabled={!name.trim() || pending}>
          <Icon name="add" /> Create club
        </button>
      </div>
    </form>
  )
}

/**
 * One book in the club's history - a past read or a book set aside. Right-click
 * offers "Move to Up next", which is how a club un-shelves a book (or corrects
 * one that was marked finished when it never was).
 */
function PastBookCard({
  book,
  finished,
  canRequeue,
  requeuePending,
  onView,
  onRequeue,
}: {
  book: HSClubBook
  finished?: boolean
  canRequeue: boolean
  requeuePending: boolean
  onView: () => void
  onRequeue: () => void
}) {
  return (
    <ClubBookMenu
      book={book}
      actions={[
        canRequeue && {
          label: 'Move to Up next',
          icon: 'playlist_add',
          disabled: requeuePending,
          onSelect: onRequeue,
        },
        { label: 'View discussion', icon: 'forum', onSelect: onView },
      ]}
    >
      <div className="book-club-past-card">
        <button type="button" onClick={onView}>
          <Cover
            itemId={book.libraryItemId}
            title={book.title}
            author={book.author}
            width={120}
            fs={7}
            finished={finished}
            className="book-club-past-cover"
          />
          <span>
            <strong>{book.title}</strong>
            <small>{book.author}</small>
            <em>
              View discussion <Icon name="arrow_forward" />
            </em>
          </span>
        </button>
      </div>
    </ClubBookMenu>
  )
}

function InviteReadersDialog({
  target,
  clubId,
  clubName,
  onClose,
}: {
  target: AbsTarget
  clubId: string
  clubName: string
  onClose: () => void
}) {
  const { show } = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const invitees = useQuery({
    queryKey: ['club-invitees', target.serverId, clubId],
    queryFn: () => getClubInvitees(target, clubId),
  })
  const invite = useMutation({
    mutationFn: () => inviteClubUsers(target, clubId, selected),
    onSuccess: async (results) => {
      setSelected([])
      await invitees.refetch()
      const sent = results.filter((result) => result.invited).length
      const withoutEmail = results.filter(
        (result) => result.invited && result.emailSent === false,
      ).length
      show(
        withoutEmail > 0
          ? `${sent} ${sent === 1 ? 'invitation' : 'invitations'} sent in-app; ${withoutEmail} could not be emailed.`
          : `${sent} ${sent === 1 ? 'invitation' : 'invitations'} sent.`,
      )
    },
    onError: () => show('Could not send those invitations.'),
  })
  const revoke = useMutation({
    mutationFn: (invitee: ClubInvitee) =>
      revokeClubInvite(target, clubId, invitee.pendingInviteId!),
    onSuccess: () => void invitees.refetch(),
    onError: () => show('Could not cancel that invitation.'),
  })

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const users = invitees.data ?? []
  return (
    <div
      className="modal-scrim open"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal club-invite-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-invite-title"
      >
        <header className="modal-head">
          <div className="club-invite-heading">
            <span className="eyebrow">{clubName}</span>
            <h2 id="club-invite-title">Invite readers</h2>
          </div>
          <button type="button" className="modal-nav-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body club-invite-body">
          <p className="club-invite-help">
            Choose readers from this server. They’ll receive an in-app invitation and an email when
            an address is available.
          </p>
          {invitees.isLoading ? (
            <LoadingSpinner className="py-12" label="Loading readers…" />
          ) : invitees.isError ? (
            <ErrorState
              message="Could not load readers from this server."
              onRetry={() => void invitees.refetch()}
            />
          ) : users.length === 0 ? (
            <div className="club-invite-empty">
              <Icon name="group" />
              <strong>Everyone is already here</strong>
              <span>There are no other server readers available to invite.</span>
            </div>
          ) : (
            <div className="club-invite-list">
              {users.map((user) => {
                const checked = selected.includes(user.userId)
                return (
                  <div className="club-invite-reader" key={user.userId}>
                    <Avatar
                      name={user.username}
                      target={target}
                      userId={user.userId}
                      size={40}
                      className="hs-avatar"
                    />
                    <div>
                      <strong>{user.username}</strong>
                      <span>{user.pendingInviteId ? 'Invitation pending' : 'On this server'}</span>
                    </div>
                    {user.pendingInviteId ? (
                      <button
                        type="button"
                        className="pill"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(user)}
                      >
                        Cancel invite
                      </button>
                    ) : (
                      <label className="club-invite-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelected((value) =>
                              checked
                                ? value.filter((id) => id !== user.userId)
                                : [...value, user.userId],
                            )
                          }
                        />
                        <span>{checked ? 'Selected' : 'Select'}</span>
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <span className="club-invite-selection">
            {selected.length > 0 ? `${selected.length} selected` : 'Select one or more readers'}
          </span>
          <span className="spacer" />
          <button type="button" className="pill" onClick={onClose}>
            Done
          </button>
          <button
            type="button"
            className="pill on"
            disabled={selected.length === 0 || invite.isPending}
            onClick={() => invite.mutate()}
          >
            <Icon name="send" /> {invite.isPending ? 'Sending…' : 'Send invites'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function ClubTimeline({
  members,
  notes,
  locked,
  meId,
  duration,
  livePosition,
  target,
}: {
  members: HSClubMember[]
  notes: HSNote[]
  locked: { id: string; timeSec: number }[]
  meId: string | undefined
  duration: number
  livePosition?: number
  target: AbsTarget
}) {
  const mine = members.find((member) => member.userId === meId)
  const myPosition = livePosition ?? mine?.currentTime ?? 0
  const myFraction = duration > 0 ? Math.max(0, Math.min(1, myPosition / duration)) : 0
  const readable = notes.filter((note) => !note.parentId && note.timeSec != null)
  // Stack pins that land close together onto extra rows. Absolutely positioning
  // every member at their own percentage buries a whole cluster under one avatar
  // whenever a club reads at the same pace - which is the normal case.
  const memberPins = useMemo(() => {
    const sorted = [...members]
      .map((member) => ({ member, fraction: progressOf(member) }))
      .sort((a, b) => a.fraction - b.fraction)
    const rowEnds: number[] = []
    return sorted.map(({ member, fraction }) => {
      let row = rowEnds.findIndex((end) => fraction > end)
      if (row === -1) row = rowEnds.length
      rowEnds[row] = fraction + PIN_MIN_GAP
      return { member, fraction, row }
    })
  }, [members])
  const trackHeight = (Math.max(...memberPins.map((p) => p.row), 0) + 1) * PIN_ROW_H + 20

  if (duration <= 0)
    return (
      <div className="book-club-timeline-unavailable">
        Timeline appears once listening progress is available.
      </div>
    )

  return (
    <div className="book-club-timeline" aria-label="Book timeline">
      <div className="book-club-timeline-labels">
        <span>Start</span>
        <span>{formatTimestamp(duration)}</span>
      </div>
      <div className="book-club-timeline-rail">
        <span className="book-club-timeline-read" style={{ width: pct(myFraction) }} />
        <span className="book-club-timeline-ahead" style={{ left: pct(myFraction) }} />
        <span className="book-club-timeline-you" style={{ left: pct(myFraction) }}>
          <i />
          <b>You · {pct(myFraction)}</b>
        </span>
        {readable.map((note) => {
          const fraction = Math.max(0, Math.min(1, (note.timeSec ?? 0) / duration))
          return (
            <button
              key={note.id}
              type="button"
              className="book-club-comment-marker"
              style={{ left: pct(fraction) }}
              title={`Comment at ${formatTimestamp(note.timeSec ?? 0)}`}
              aria-label={`Go to comment at ${formatTimestamp(note.timeSec ?? 0)}`}
              onClick={() =>
                document
                  .getElementById(`club-note-${note.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              <Icon name="chat_bubble" fill />
            </button>
          )
        })}
        {locked.map((note) => {
          const fraction = Math.max(0, Math.min(1, note.timeSec / duration))
          return (
            <span
              key={note.id}
              className="book-club-comment-marker locked"
              style={{ left: pct(fraction) }}
              title={`Comment unlocks at ${formatTimestamp(note.timeSec)}`}
            >
              <Icon name="lock" fill />
            </span>
          )
        })}
      </div>
      <div className="book-club-member-track" style={{ height: trackHeight }}>
        {memberPins.map(({ member, fraction, row }) => (
          <span
            key={member.userId}
            className={'book-club-member-pin' + (member.userId === meId ? ' me' : '')}
            style={
              {
                left: pct(fraction),
                top: row * PIN_ROW_H,
                // Reach back up to the rail: further for each row we stacked down.
                '--pin-lead': `${row * PIN_ROW_H + 8}px`,
              } as CSSProperties
            }
            title={`${member.username} · ${member.isFinished ? 'Finished' : pct(fraction)}`}
          >
            <Avatar
              name={member.username}
              target={target}
              userId={member.userId}
              size={30}
              className="hs-avatar"
            />
            {member.listeningNow && <i />}
            <UserLink
              userId={member.userId}
              username={member.username}
              className="book-club-member-pin-name"
            />
            {/* How far in they are. It was hover-only, so a pin told you WHO
                without telling you how far - the one thing the track is for. */}
            <span className="book-club-member-pin-pct">
              {member.isFinished ? 'Finished' : pct(fraction)}
            </span>
          </span>
        ))}
      </div>
      <div className="book-club-timeline-key">
        <span>
          <i className="readable" /> Readable discussion
        </span>
        <span>
          <i className="locked" /> Unlocks when you reach it
        </span>
        <span className="book-club-spoiler-note">
          <Icon name="shield" /> Ahead comments stay private
        </span>
      </div>
    </div>
  )
}

function DiscussionNote({
  note,
  replies,
  meId,
  isOwner,
  target,
  activeBook,
  onDelete,
  onReply,
}: {
  note: HSNote
  replies: HSNote[]
  meId: string | undefined
  isOwner: boolean
  target: AbsTarget
  activeBook: boolean
  onDelete: (id: string) => void
  onReply: (note: HSNote) => void
}) {
  const { day, time } = fmtSessDate(note.createdAt)
  return (
    <article className="book-club-note" id={`club-note-${note.id}`}>
      <Avatar
        name={note.username}
        target={target}
        userId={note.userId}
        size={34}
        className="hs-avatar"
      />
      <div className="book-club-note-body">
        <div className="book-club-note-meta">
          <strong>
            <UserLink userId={note.userId} username={note.username} />
          </strong>
          {note.safe && (
            <span className="badge-pill abridged">
              <Icon name="shield" /> Spoiler-free
            </span>
          )}
          <span>
            {day} · {time}
          </span>
        </div>
        <NoteBody note={note} target={target} />
        <div className="book-club-note-actions">
          {note.timeSec != null && (
            <span className="book-club-time-chip">
              <Icon name="play_arrow" fill /> {formatTimestamp(note.timeSec)}
            </span>
          )}
          {activeBook && (
            <button type="button" onClick={() => onReply(note)}>
              Reply
            </button>
          )}
          {(note.userId === meId || isOwner) && (
            <button type="button" onClick={() => onDelete(note.id)}>
              Delete
            </button>
          )}
        </div>
        {replies.length > 0 && (
          <div className="book-club-replies">
            {replies.map((reply) => {
              const replyDate = fmtSessDate(reply.createdAt)
              return (
                <div className="book-club-reply" key={reply.id}>
                  <Avatar
                    name={reply.username}
                    target={target}
                    userId={reply.userId}
                    size={26}
                    className="hs-avatar"
                  />
                  <div>
                    <div className="book-club-note-meta">
                      <strong>
                        <UserLink userId={reply.userId} username={reply.username} />
                      </strong>
                      <span>
                        {replyDate.day} · {replyDate.time}
                      </span>
                    </div>
                    <NoteBody note={reply} target={target} />
                    {(reply.userId === meId || isOwner) && (
                      <button type="button" onClick={() => onDelete(reply.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}

function ClubRoom({
  target,
  meId,
  data,
  viewedBookId,
  onViewBook,
  onClubRemoved,
}: {
  target: AbsTarget
  meId: string | undefined
  data: HSClubDetail
  viewedBookId: string | undefined
  onViewBook: (id: string | undefined) => void
  onClubRemoved: () => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ui = useMediaUI()
  const player = usePlayer()
  const { toast, show } = useToast()
  const [draft, setDraft] = useState('')
  const [safe, setSafe] = useState(false)
  const [addTimestamp, setAddTimestamp] = useState(true)
  const [replyingTo, setReplyingTo] = useState<HSNote | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  // Ids picked from the @ list, per composer. Collected on selection rather than
  // re-parsed from the text, so a renamed or space-containing username can't be
  // mis-resolved. Filtered against the final body on post, so deleting the "@name"
  // drops the mention with it.
  const [draftMentions, setDraftMentions] = useState<MentionCandidate[]>([])
  const [replyMentions, setReplyMentions] = useState<MentionCandidate[]>([])
  const [inviting, setInviting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const { activeId: libraryId } = useActiveLibrary()

  const { club, books, queue, notes, members } = data
  const currentBookId = club.currentBook?.libraryItemId
  const viewedBook =
    books.find((book) => book.libraryItemId === (viewedBookId ?? currentBookId)) ?? club.currentBook
  const isCurrentBook = Boolean(viewedBook && viewedBook.libraryItemId === currentBookId)
  const isOwner = club.createdBy === meId
  const inPlayer = Boolean(
    viewedBook &&
    player.now?.serverId === target.serverId &&
    player.now.itemId === viewedBook.libraryItemId,
  )
  const duration = Math.max(
    inPlayer ? (player.now?.totalDurationSec ?? 0) : 0,
    ...members.map((member) => member.duration ?? 0),
  )
  const detailKey = clubsKeys.detail(target.serverId, club.id, viewedBookId ?? '')
  const invalidate = () => qc.invalidateQueries({ queryKey: clubQueryPrefix(target.serverId) })

  const post = useMutation({
    mutationFn: (input: { body: string; parentId?: string; mentions?: MentionCandidate[] }) =>
      createNote(target, {
        libraryItemId: viewedBook!.libraryItemId,
        clubId: club.id,
        parentId: input.parentId,
        timeSec:
          !input.parentId && addTimestamp && inPlayer
            ? Math.max(0, Math.floor(player.positionSec))
            : undefined,
        safe: input.parentId ? false : safe,
        body: input.body,
        mentions: pickedMentions(input.body, input.mentions ?? []),
      }),
    onSuccess: () => {
      setDraft('')
      setReplyDraft('')
      setReplyingTo(null)
      setSafe(false)
      setDraftMentions([])
      setReplyMentions([])
      void qc.invalidateQueries({ queryKey: detailKey })
    },
    onError: () => show('Could not post. Try again.'),
  })
  const removeNote = useMutation({
    mutationFn: (id: string) => deleteNote(target, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: detailKey }),
    onError: () => show('Could not delete that comment.'),
  })
  const leave = useMutation({
    mutationFn: () => leaveClub(target, club.id),
    onSuccess: onClubRemoved,
    onError: () => show('Could not leave the club.'),
  })
  const archive = useMutation({
    mutationFn: () => archiveClub(target, club.id),
    onSuccess: onClubRemoved,
    onError: () => show('Could not archive the club.'),
  })
  const hardDelete = useMutation({
    mutationFn: () => deleteClub(target, club.id),
    onSuccess: onClubRemoved,
    onError: () => show('Could not delete the club.'),
  })
  const kick = useMutation({
    mutationFn: (userId: string) => kickMember(target, club.id, userId),
    onSuccess: () => void invalidate(),
    onError: () => show('Could not remove that member.'),
  })
  const promote = useMutation({
    mutationFn: (libraryItemId: string) => advanceClubBook(target, club.id, libraryItemId),
    onSuccess: () => {
      onViewBook(undefined)
      void invalidate()
    },
    onError: () => show('Could not start that book.'),
  })
  const removeQueued = useMutation({
    mutationFn: (libraryItemId: string) => removeQueuedClubBook(target, club.id, libraryItemId),
    onSuccess: () => void invalidate(),
    onError: () => show('Could not remove that book.'),
  })
  // Start a book while SETTING ASIDE the outgoing one rather than calling it
  // finished - for a book the club shelved without reading it.
  const shelveAndStart = useMutation({
    mutationFn: (libraryItemId: string) => advanceClubBook(target, club.id, libraryItemId, false),
    onSuccess: () => {
      onViewBook(undefined)
      void invalidate()
    },
    onError: () => show('Could not start that book.'),
  })
  const requeue = useMutation({
    mutationFn: (libraryItemId: string) => requeueClubBook(target, club.id, libraryItemId),
    onSuccess: () => {
      onViewBook(undefined)
      show('Moved back to Up next.')
      void invalidate()
    },
    onError: () => show('Could not move that book. Start a different book first.'),
  })
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderClubQueue(target, club.id, ids),
    onSuccess: () => void invalidate(),
    onError: () => show('Could not reorder the queue.'),
  })

  // Move a queued book one slot up or down and persist the whole new order.
  const moveQueued = (index: number, delta: number) => {
    const next = queue.map((b) => b.libraryItemId)
    const to = index + delta
    if (to < 0 || to >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    reorder.mutate(next)
  }

  const visibleQueue = queueExpanded ? queue : queue.slice(0, QUEUE_PREVIEW)

  // Starting a queued book has to settle what happens to the book leaving the
  // current slot: it either finished, or the club is shelving it unread. Asking
  // is what keeps an unread book out of Past reads.
  const onStartQueued = (book: HSClubBook) => {
    const outgoing = club.currentBook
    if (!outgoing) {
      promote.mutate(book.libraryItemId)
      return
    }
    const finished = window.confirm(
      `Start ${book.title}?

OK: the club FINISHED ${outgoing.title} - move it to Past reads.
Cancel: the club is SETTING ASIDE ${outgoing.title} unread - keep it available to come back to.`,
    )
    if (finished) promote.mutate(book.libraryItemId)
    else shelveAndStart.mutate(book.libraryItemId)
  }

  const topNotes = useMemo(
    () => notes.notes.filter((note) => !note.parentId).sort((a, b) => a.createdAt - b.createdAt),
    [notes.notes],
  )
  const repliesByParent = useMemo(() => {
    const grouped = new Map<string, HSNote[]>()
    for (const note of notes.notes) {
      if (!note.parentId) continue
      const replies = grouped.get(note.parentId) ?? []
      replies.push(note)
      grouped.set(note.parentId, replies)
    }
    return grouped
  }, [notes.notes])
  const sortedMembers = useMemo(() => sortMembersByProgress(members), [members])

  // A mention notification links to ?note=<id>. Scroll that comment into view
  // and flash it once the thread has rendered, so the reader lands on what was
  // actually said rather than the top of the room. Runs per note id, not per
  // render, or the page would keep yanking itself back while they read.
  const [noteParams, setNoteParams] = useSearchParams()
  const deepLinkNote = noteParams.get('note')
  useEffect(() => {
    if (!deepLinkNote || !notes.notes.length) return
    const el = document.getElementById(`club-note-${deepLinkNote}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('note-flash')
    const timer = window.setTimeout(() => el.classList.remove('note-flash'), 2400)
    // Drop the param so a later refresh doesn't re-scroll an old mention.
    const next = new URLSearchParams(noteParams)
    next.delete('note')
    setNoteParams(next, { replace: true })
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNote, notes.notes.length])
  const pastBooks = books
    .filter((book) => book.finishedAt != null)
    .sort((a, b) => b.startedAt - a.startedAt)
  // Books the club started and shelved unfinished. Kept apart from past reads
  // so a set aside book never reads as "we finished this".
  const setAsideBooks = books
    .filter((book) => book.abandonedAt != null)
    .sort((a, b) => (b.abandonedAt ?? 0) - (a.abandonedAt ?? 0))
  const allClubBooks: HSClubBook[] = [...books, ...queue]
  const myProgress = progressOf(members.find((member) => member.userId === meId))

  if (!viewedBook) {
    return (
      <section className="book-club-room book-club-no-book">
        <div className="book-club-room-head">
          <div>
            <span className="eyebrow">Book club</span>
            <h1>{club.name}</h1>
            <p>
              {club.memberCount} {club.memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          {isOwner && (
            <button className="pill" onClick={() => setInviting(true)}>
              <Icon name="person_add" /> Invite readers
            </button>
          )}
        </div>
        <div className="book-club-empty-book">
          <Icon name="menu_book" />
          <h2>Choose your first read</h2>
          <p>Search your library for a book, or line up a whole series.</p>
          <div className="book-club-empty-actions">
            {isOwner && (
              <button className="pill on" disabled={!libraryId} onClick={() => setAdding(true)}>
                <Icon name="add" /> Add books
              </button>
            )}
            <button className="pill" onClick={() => navigate('/library')}>
              <Icon name="grid_view" /> Browse library
            </button>
          </div>
        </div>
        {inviting && (
          <InviteReadersDialog
            target={target}
            clubId={club.id}
            clubName={club.name}
            onClose={() => setInviting(false)}
          />
        )}
        {adding && libraryId && (
          <AddClubBooksDialog
            target={target}
            libraryId={libraryId}
            clubId={club.id}
            clubName={club.name}
            existing={allClubBooks}
            onClose={() => setAdding(false)}
            onAdded={() => void invalidate()}
          />
        )}
      </section>
    )
  }

  return (
    <section className="book-club-room">
      <div className="book-club-room-head">
        <div>
          <span className="eyebrow">Book club</span>
          <h1>{club.name}</h1>
          <p>
            {club.memberCount} {club.memberCount === 1 ? 'member' : 'members'} ·{' '}
            {isCurrentBook
              ? 'Reading now'
              : viewedBook?.abandonedAt != null
                ? 'Set aside'
                : 'Past read'}
          </p>
        </div>
        <div className="book-club-room-actions">
          {isOwner && (
            <button className="pill" onClick={() => setInviting(true)}>
              <Icon name="person_add" /> Invite readers
            </button>
          )}
          {!isOwner ? (
            <button
              className="pill"
              disabled={leave.isPending}
              onClick={() => window.confirm('Leave this club?') && leave.mutate()}
            >
              <Icon name="logout" /> Leave
            </button>
          ) : (
            <details className="book-club-manage">
              <summary className="pill">
                <Icon name="more_horiz" /> Manage
              </summary>
              <div>
                <button
                  type="button"
                  onClick={() => window.confirm('Archive this club?') && archive.mutate()}
                >
                  <Icon name="archive" /> Archive club
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    window.confirm(
                      'Permanently delete this club and all of its discussions? This cannot be undone.',
                    ) && hardDelete.mutate()
                  }
                >
                  <Icon name="delete" /> Delete forever
                </button>
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="book-club-hero">
        <Cover
          itemId={viewedBook.libraryItemId}
          title={viewedBook.title}
          author={viewedBook.author}
          width={240}
          fs={11}
          className="book-club-hero-cover"
          onClick={() => ui.openItem(viewedBook.libraryItemId)}
        />
        <div className="book-club-hero-copy">
          <span className="book-club-now-label">
            {isCurrentBook ? 'Currently reading' : 'From the club archive'}
          </span>
          <h2>{viewedBook.title}</h2>
          <p>by {viewedBook.author}</p>
          {isCurrentBook && (
            <div className="book-club-hero-progress">
              <span>
                <b>{pct(myProgress)}</b> of the book
              </span>
              <div className="prog-line">
                <i style={{ width: pct(myProgress) }} />
              </div>
            </div>
          )}
          {!isCurrentBook && (
            <button className="read-more" onClick={() => onViewBook(undefined)}>
              <Icon name="arrow_back" /> Back to current read
            </button>
          )}
        </div>
        <div className="book-club-hero-play">
          {!inPlayer ? (
            <button
              className="btn btn-primary"
              onClick={() => void ui.playItem(viewedBook.libraryItemId)}
            >
              <Icon name="play_arrow" fill /> Play
            </button>
          ) : (
            <button className="pill on" onClick={() => navigate('/player')}>
              <Icon name="graphic_eq" /> In player
            </button>
          )}
          <button className="read-more" onClick={() => ui.openItem(viewedBook.libraryItemId)}>
            View book
          </button>
        </div>
      </div>

      <section className="book-club-section timeline-section">
        <div className="book-club-section-head">
          <div>
            <span className="eyebrow">Your place in the story</span>
            <h2>Book timeline</h2>
          </div>
          <span>
            {notes.hiddenAhead > 0
              ? `${notes.hiddenAhead} ahead ${notes.hiddenAhead === 1 ? 'comment' : 'comments'}`
              : 'You are caught up'}
          </span>
        </div>
        <ClubTimeline
          members={members}
          notes={notes.notes}
          locked={notes.locked}
          meId={meId}
          duration={duration}
          livePosition={inPlayer ? player.positionSec : undefined}
          target={target}
        />
      </section>

      <div className="book-club-content-grid">
        <div className="book-club-main-column">
          <section className="book-club-section">
            <div className="book-club-section-head">
              <div>
                <span className="eyebrow">For this book</span>
                <h2>Discussion</h2>
              </div>
              {data.unreadCount > 0 && (
                <span className="book-club-unread">
                  <i /> {data.unreadCount} new
                </span>
              )}
            </div>
            {isCurrentBook && (
              <div className="book-club-composer">
                <MentionInput
                  rows={3}
                  placeholder="Share a thought with the club… use @ to mention someone"
                  value={draft}
                  onChange={setDraft}
                  onMention={(member) =>
                    setDraftMentions((picked) =>
                      picked.some((p) => p.userId === member.userId) ? picked : [...picked, member],
                    )
                  }
                  members={members}
                  target={target}
                  meId={meId}
                />
                <div>
                  <span className="book-club-composer-tools">
                    {inPlayer && (
                      <button
                        type="button"
                        className={'pill' + (addTimestamp ? ' on' : '')}
                        onClick={() => setAddTimestamp(!addTimestamp)}
                      >
                        <Icon name="schedule" /> {formatTimestamp(player.positionSec)}
                      </button>
                    )}
                    <button
                      type="button"
                      className={'pill' + (safe ? ' on' : '')}
                      onClick={() => setSafe(!safe)}
                      title="Visible before other members reach this point"
                    >
                      <Icon name="shield" /> Spoiler-free
                    </button>
                  </span>
                  <button
                    className="pill on"
                    disabled={!draft.trim() || post.isPending}
                    onClick={() => post.mutate({ body: draft.trim(), mentions: draftMentions })}
                  >
                    <Icon name="send" /> Post
                  </button>
                </div>
              </div>
            )}
            {topNotes.length === 0 ? (
              <div className="book-club-empty-discussion">
                <Icon name="forum" />
                <p>No discussion yet for this book.</p>
              </div>
            ) : (
              <div className="book-club-discussion">
                {topNotes.map((note) => (
                  <DiscussionNote
                    key={note.id}
                    note={note}
                    replies={(repliesByParent.get(note.id) ?? []).sort(
                      (a, b) => a.createdAt - b.createdAt,
                    )}
                    meId={meId}
                    isOwner={isOwner}
                    target={target}
                    activeBook={isCurrentBook}
                    onDelete={(id) => removeNote.mutate(id)}
                    onReply={setReplyingTo}
                  />
                ))}
              </div>
            )}
            {notes.hiddenAhead > 0 && (
              <div className="book-club-locked-teaser">
                <Icon name="lock" fill />
                <div>
                  <strong>
                    {notes.hiddenAhead} {notes.hiddenAhead === 1 ? 'discussion' : 'discussions'}{' '}
                    waiting ahead
                  </strong>
                  <span>They unlock as your listening progress reaches them.</span>
                </div>
              </div>
            )}
          </section>

          <section className="book-club-section">
            <div className="book-club-section-head">
              <div>
                <span className="eyebrow">Club library</span>
                <h2>Past reads</h2>
              </div>
            </div>
            {pastBooks.length === 0 ? (
              <div className="book-club-empty-discussion">
                <Icon name="history" />
                <p>Finished club books will stay here with their discussions.</p>
              </div>
            ) : (
              <div className="book-club-past-grid">
                {pastBooks.map((book) => (
                  <PastBookCard
                    key={book.libraryItemId}
                    book={book}
                    finished
                    canRequeue={isOwner}
                    requeuePending={requeue.isPending}
                    onView={() => onViewBook(book.libraryItemId)}
                    onRequeue={() => requeue.mutate(book.libraryItemId)}
                  />
                ))}
              </div>
            )}
          </section>

          {setAsideBooks.length > 0 && (
            <section className="book-club-section">
              <div className="book-club-section-head">
                <div>
                  <span className="eyebrow">Club library</span>
                  <h2>Set aside</h2>
                  <p className="book-club-section-note">
                    Started but not finished. Move one back to Up next whenever the club is ready
                    for it.
                  </p>
                </div>
              </div>
              <div className="book-club-past-grid">
                {setAsideBooks.map((book) => (
                  <PastBookCard
                    key={book.libraryItemId}
                    book={book}
                    canRequeue={isOwner}
                    requeuePending={requeue.isPending}
                    onView={() => onViewBook(book.libraryItemId)}
                    onRequeue={() => requeue.mutate(book.libraryItemId)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="book-club-side-column">
          <section className="book-club-section">
            <div className="book-club-section-head compact">
              <h2>Reading progress</h2>
              <span>
                {members.filter((member) => member.isFinished).length}/{members.length} finished
              </span>
            </div>
            <div className="book-club-progress-list">
              {sortedMembers.map((member, index) => {
                const progress = progressOf(member)
                return (
                  <div className="book-club-progress-row" key={member.userId}>
                    <span className="book-club-rank">{index + 1}</span>
                    <Avatar
                      name={member.username}
                      target={target}
                      userId={member.userId}
                      size={30}
                      className="hs-avatar"
                    />
                    <div>
                      <strong>
                        {member.userId === meId ? (
                          'You'
                        ) : (
                          <UserLink userId={member.userId} username={member.username} />
                        )}
                      </strong>
                      <span>{member.isFinished ? 'Finished' : pct(progress)}</span>
                      <div className="prog-line">
                        <i style={{ width: pct(progress) }} />
                      </div>
                      {member.reach && member.reach.total > 1 && (
                        <em
                          className={
                            member.reach.aheadOfClub ? 'book-club-reach ahead' : 'book-club-reach'
                          }
                          title={member.reach.title}
                        >
                          {member.reach.aheadOfClub && <Icon name="fast_forward" />}
                          Book {member.reach.index + 1} of {member.reach.total}
                        </em>
                      )}
                    </div>
                    {member.listeningNow && <Icon name="graphic_eq" className="book-club-live" />}
                    {isOwner && member.role !== 'owner' && (
                      <button
                        className="tbl-icon"
                        title={`Remove ${member.username}`}
                        onClick={() =>
                          window.confirm(`Remove ${member.username} from the club?`) &&
                          kick.mutate(member.userId)
                        }
                      >
                        <Icon name="person_remove" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="book-club-section">
            <div className="book-club-section-head compact">
              <h2>Up next</h2>
              <span>{queue.length}</span>
            </div>
            {isOwner && (
              <button
                type="button"
                className="pill book-club-add-btn"
                disabled={!libraryId}
                onClick={() => setAdding(true)}
              >
                <Icon name="add" /> Add books
              </button>
            )}
            {queue.length === 0 ? (
              <div className="book-club-empty-side">
                <Icon name="playlist_add" />
                <span>
                  {isOwner
                    ? 'Add a book to line up the club’s next read.'
                    : 'The club owner has not lined up a next read yet.'}
                </span>
              </div>
            ) : (
              <>
                <div className="book-club-queue">
                  {visibleQueue.map((book, index) => (
                    <ClubBookMenu
                      key={book.libraryItemId}
                      book={book}
                      actions={[
                        isOwner && {
                          label: 'Start this book now',
                          icon: 'play_circle',
                          disabled: promote.isPending || shelveAndStart.isPending,
                          onSelect: () => onStartQueued(book),
                        },
                        isOwner &&
                          index > 0 && {
                            label: 'Move up',
                            icon: 'arrow_upward',
                            disabled: reorder.isPending,
                            onSelect: () => moveQueued(index, -1),
                          },
                        isOwner &&
                          index < queue.length - 1 && {
                            label: 'Move down',
                            icon: 'arrow_downward',
                            disabled: reorder.isPending,
                            onSelect: () => moveQueued(index, 1),
                          },
                        isOwner &&
                          index > 0 && {
                            label: 'Move to top',
                            icon: 'vertical_align_top',
                            disabled: reorder.isPending,
                            onSelect: () => moveQueued(index, -index),
                          },
                        isOwner && {
                          label: 'Remove from queue',
                          icon: 'close',
                          danger: true,
                          disabled: removeQueued.isPending,
                          onSelect: () => removeQueued.mutate(book.libraryItemId),
                        },
                      ]}
                    >
                      <div className="book-club-queue-row">
                        <span className="book-club-queue-number">{index + 1}</span>
                        <Cover
                          itemId={book.libraryItemId}
                          title={book.title}
                          author={book.author}
                          width={80}
                          fs={6}
                          className="book-club-queue-cover"
                        />
                        <span>
                          <strong>{book.title}</strong>
                          <small>{book.author}</small>
                        </span>
                        {isOwner && (
                          // Reordering also lives in the right-click menu, but a
                          // hidden menu is not a control: without these the queue
                          // order looks fixed, and touch has no right-click at all.
                          <span className="book-club-queue-reorder">
                            <button
                              type="button"
                              className="ab-ico"
                              title="Move up"
                              aria-label={`Move ${book.title || 'this book'} up`}
                              disabled={index === 0 || reorder.isPending}
                              onClick={(event) => {
                                event.stopPropagation()
                                moveQueued(index, -1)
                              }}
                            >
                              <Icon name="arrow_upward" />
                            </button>
                            <button
                              type="button"
                              className="ab-ico"
                              title="Move down"
                              aria-label={`Move ${book.title || 'this book'} down`}
                              disabled={index === queue.length - 1 || reorder.isPending}
                              onClick={(event) => {
                                event.stopPropagation()
                                moveQueued(index, 1)
                              }}
                            >
                              <Icon name="arrow_downward" />
                            </button>
                          </span>
                        )}
                      </div>
                    </ClubBookMenu>
                  ))}
                </div>
                {queue.length > QUEUE_PREVIEW && (
                  <button
                    type="button"
                    className="pill book-club-queue-toggle"
                    onClick={() => setQueueExpanded((open) => !open)}
                  >
                    {queueExpanded ? (
                      <>
                        <Icon name="expand_less" /> Show less
                      </>
                    ) : (
                      <>
                        <Icon name="expand_more" /> View all {queue.length}
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </section>
        </aside>
      </div>

      {replyingTo && (
        <div
          className="book-club-reply-bar"
          role="dialog"
          aria-label={`Reply to ${replyingTo.username}`}
        >
          <div>
            <span>
              Replying to <strong>{replyingTo.username}</strong>
            </span>
            <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
              <Icon name="close" />
            </button>
          </div>
          <MentionInput
            rows={2}
            autoFocus
            value={replyDraft}
            onChange={setReplyDraft}
            onMention={(member) =>
              setReplyMentions((picked) =>
                picked.some((p) => p.userId === member.userId) ? picked : [...picked, member],
              )
            }
            members={members}
            target={target}
            meId={meId}
            placeholder="Write a reply… use @ to mention someone"
          />
          <button
            className="pill on"
            disabled={!replyDraft.trim() || post.isPending}
            onClick={() =>
              post.mutate({
                body: replyDraft.trim(),
                parentId: replyingTo.id,
                mentions: replyMentions,
              })
            }
          >
            <Icon name="send" /> Reply
          </button>
        </div>
      )}
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      {inviting && (
        <InviteReadersDialog
          target={target}
          clubId={club.id}
          clubName={club.name}
          onClose={() => setInviting(false)}
        />
      )}
      {adding && libraryId && (
        <AddClubBooksDialog
          target={target}
          libraryId={libraryId}
          clubId={club.id}
          clubName={club.name}
          existing={allClubBooks}
          onClose={() => setAdding(false)}
          onAdded={() => void invalidate()}
        />
      )}
    </section>
  )
}

/** One club opens directly; multiple clubs use a persistent overview rail. */
export function ClubRoomPage() {
  const { clubId } = useParams()
  const [searchParams] = useSearchParams()
  const invitedClubId = searchParams.get('club')
  const inviteId = searchParams.get('invite')
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const player = usePlayer()
  const [creating, setCreating] = useState(false)
  const [viewedBookId, setViewedBookId] = useState<string | undefined>()
  const processedInvite = useRef<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })
  const listKey = clubsKeys.list(target?.serverId ?? '', '')
  const clubsQuery = useQuery({
    queryKey: listKey,
    queryFn: () => getClubs(target!),
    enabled: Boolean(target),
    staleTime: 15 * 1000,
  })
  const clubs = clubsQuery.data?.mine ?? []
  const selectedId = clubId ?? clubs[0]?.id
  const selectedSummary = clubs.find((club) => club.id === selectedId)
  const activeViewedId = viewedBookId ?? selectedSummary?.currentBook?.libraryItemId
  const nowPlaying = player.now
  const playerPosition =
    nowPlaying?.serverId === target?.serverId && nowPlaying?.itemId === activeViewedId
      ? player.positionSec
      : undefined
  const detailQuery = useQuery({
    queryKey: clubsKeys.detail(target?.serverId ?? '', selectedId ?? '', viewedBookId ?? ''),
    queryFn: () =>
      getClubDetail(target!, selectedId!, { bookId: viewedBookId, position: playerPosition }),
    enabled: Boolean(target && selectedId),
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
  })

  useEffect(() => setViewedBookId(undefined), [selectedId])
  useEffect(() => {
    if (!target || !inviteId || !invitedClubId || processedInvite.current === inviteId) return
    processedInvite.current = inviteId
    void respondToClubInvite(target, invitedClubId, inviteId, true)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: listKey })
        navigate(`/club/${invitedClubId}`, { replace: true })
        show('You joined the book club.')
      })
      .catch(() => {
        processedInvite.current = null
        show('That invite is no longer available.')
      })
  }, [inviteId, invitedClubId, listKey, navigate, qc, show, target])
  useEffect(() => {
    if (!target || !selectedId || !detailQuery.data?.enabled) return
    const latest = detailQuery.data.notes.notes.reduce(
      (max, note) => Math.max(max, note.createdAt),
      0,
    )
    if (latest > 0) void markClubRead(target, selectedId, latest).catch(() => {})
  }, [detailQuery.data?.enabled, detailQuery.data?.notes.notes, selectedId, target])

  const create = useMutation({
    mutationFn: (name: string) => createClub(target!, { name }),
    onSuccess: async (club) => {
      setCreating(false)
      await qc.invalidateQueries({ queryKey: listKey })
      navigate(`/club/${club.id}`)
    },
    onError: () => show('Could not create the club.'),
  })
  const removed = async () => {
    await qc.invalidateQueries({ queryKey: listKey })
    navigate('/clubs', { replace: true })
  }

  if (!target)
    return (
      <div className="page">
        <ErrorState message="No active server." />
      </div>
    )
  if (clubsQuery.isLoading || (selectedId && detailQuery.isLoading))
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading book clubs…" />
      </div>
    )
  if (!clubsQuery.data?.enabled)
    return (
      <div className="page">
        <ErrorState
          message="Book clubs are not enabled on this server."
          onRetry={() => void clubsQuery.refetch()}
        />
      </div>
    )

  if (clubs.length === 0) {
    return (
      <div className="page book-clubs-page fade-in">
        <div className="book-clubs-page-head">
          <div>
            <span className="eyebrow">Community</span>
            <h1 className="title-xl">Book clubs</h1>
            <p>Read together without reading ahead.</p>
          </div>
        </div>
        <NewClubForm pending={create.isPending} onCreate={(name) => create.mutate(name)} />
        {toast && (
          <div className="p-toast">
            <Icon name="check_circle" fill /> {toast}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page book-clubs-page fade-in">
      <div className="book-clubs-page-head">
        <div>
          <span className="eyebrow">Community</span>
          <h1 className="title-xl">Book clubs</h1>
          <p>Read together without reading ahead.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="add" /> New club
        </button>
      </div>
      {creating && (
        <NewClubForm
          pending={create.isPending}
          onCancel={() => setCreating(false)}
          onCreate={(name) => create.mutate(name)}
        />
      )}
      <div className={'book-clubs-layout' + (clubs.length === 1 ? ' single' : '')}>
        {clubs.length > 1 && (
          <aside className="book-clubs-list">
            <div className="book-clubs-list-head">
              <strong>Your clubs</strong>
              <span>{clubs.length}</span>
            </div>
            <div>
              {clubs.map((club) => (
                <ClubMiniCard
                  key={club.id}
                  club={club}
                  target={target}
                  meId={me?.id}
                  selected={club.id === selectedId}
                  onSelect={() => navigate(`/club/${club.id}`)}
                />
              ))}
            </div>
          </aside>
        )}
        <main className="book-clubs-detail">
          {detailQuery.isError || !detailQuery.data?.enabled ? (
            <ErrorState
              message="Could not load this club."
              onRetry={() => void detailQuery.refetch()}
            />
          ) : (
            <ClubRoom
              target={target}
              meId={me?.id}
              data={detailQuery.data}
              viewedBookId={viewedBookId}
              onViewBook={setViewedBookId}
              onClubRemoved={() => void removed()}
            />
          )}
        </main>
      </div>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
