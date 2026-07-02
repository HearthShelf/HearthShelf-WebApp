import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getClubs, createClub, joinClub, advanceClubBook, clubsKeys } from '@/api/absClubs'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'

/**
 * Book Club card on the item detail page (Phase 5, minimal viable): the
 * clubs the caller is already in for this book, open clubs whose CURRENT
 * book is this item (joinable), and a create-club shortcut that starts the
 * club on this book. Degrades to nothing when clubs are disabled/unavailable.
 */
export function ClubSection({
  target,
  libraryItemId,
  title,
  author,
}: {
  target: AbsTarget
  libraryItemId: string
  title: string
  author: string
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const key = clubsKeys.list(target.serverId, libraryItemId)
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getClubs(target, libraryItemId),
    staleTime: 30 * 1000,
  })

  const { data: me } = useQuery({
    queryKey: ['abs-me', target.serverId],
    queryFn: () => getMe(target),
    staleTime: 10 * 60 * 1000,
  })

  const join = useMutation({
    mutationFn: (clubId: string) => joinClub(target, clubId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })

  const advance = useMutation({
    mutationFn: (id: string) => advanceClubBook(target, id, libraryItemId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })

  const create = useMutation({
    mutationFn: () => createClub(target, { name: name.trim(), libraryItemId }),
    onSuccess: (club) => {
      setCreating(false)
      setName('')
      void qc.invalidateQueries({ queryKey: key })
      navigate(`/club/${club.id}`)
    },
  })

  if (!data?.enabled || isLoading) return null

  const mineForThisBook = data.mine.filter((c) => c.currentBook?.libraryItemId === libraryItemId)
  const joinableIds = new Set(mineForThisBook.map((c) => c.id))
  const joinable = data.joinable.filter((c) => !joinableIds.has(c.id))
  // Clubs the caller owns that are reading a DIFFERENT book right now - offer
  // to advance them to this one instead of duplicating a create flow.
  const ownedElsewhere = data.mine.filter(
    (c) => me && c.createdBy === me.id && c.currentBook?.libraryItemId !== libraryItemId,
  )

  if (mineForThisBook.length === 0 && joinable.length === 0 && ownedElsewhere.length === 0 && !creating) {
    return (
      <div className="detail-section">
        <div className="section-head">
          <Icon name="groups_3" />
          <h2>Book Club</h2>
        </div>
        <div className="cfg-card">
          <div className="cl-d" style={{ marginBottom: 10 }}>
            Start a club on this book and read it together with other listeners on this server.
          </div>
          <button className="pill" onClick={() => setCreating(true)}>
            <Icon name="add" /> Start a club
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="detail-section">
      <div className="section-head">
        <Icon name="groups_3" />
        <h2>Book Club</h2>
      </div>

      {mineForThisBook.length > 0 && (
        <div className="cfg-card" style={{ marginBottom: 10 }}>
          {mineForThisBook.map((c) => (
            <div className="cfg-line" key={c.id} onClick={() => navigate(`/club/${c.id}`)} style={{ cursor: 'pointer' }}>
              <Icon name="groups_3" style={{ color: 'var(--accent)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">{c.name}</div>
                <div className="cl-d">
                  {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · reading now
                </div>
              </div>
              <Icon name="chevron_right" style={{ color: 'var(--text-muted)' }} />
            </div>
          ))}
        </div>
      )}

      {joinable.length > 0 && (
        <div className="cfg-card" style={{ marginBottom: 10 }}>
          <div className="cl-d" style={{ marginBottom: 8 }}>
            Open clubs currently reading this book
          </div>
          {joinable.map((c) => (
            <div className="cfg-line" key={c.id}>
              <Icon name="groups_3" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">{c.name}</div>
                <div className="cl-d">
                  {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · members see your
                  progress in this club's books
                </div>
              </div>
              <button className="pill" disabled={join.isPending} onClick={() => join.mutate(c.id)}>
                <Icon name="login" /> Join
              </button>
            </div>
          ))}
        </div>
      )}

      {ownedElsewhere.length > 0 && (
        <div className="cfg-card" style={{ marginBottom: 10 }}>
          <div className="cl-d" style={{ marginBottom: 8 }}>
            Move a club you own onto this book (archives its current book's chat - still
            readable in history)
          </div>
          {ownedElsewhere.map((c) => (
            <div className="cfg-line" key={c.id}>
              <Icon name="groups_3" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">{c.name}</div>
                <div className="cl-d">currently reading {c.currentBook?.title ?? 'nothing'}</div>
              </div>
              <button
                className="pill"
                disabled={advance.isPending}
                onClick={() => advance.mutate(c.id)}
              >
                <Icon name="arrow_forward" /> Move here
              </button>
            </div>
          ))}
        </div>
      )}

      {!creating ? (
        <button className="pill" onClick={() => setCreating(true)}>
          <Icon name="add" /> Start another club on this book
        </button>
      ) : (
        <div className="cfg-card">
          <div className="cl-d" style={{ marginBottom: 8 }}>
            New club, starting with <strong>{title}</strong> by {author}
          </div>
          <input
            className="fld"
            placeholder="Club name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="pill on"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Avatar name={name || '?'} size={16} className="hs-avatar" /> Create
            </button>
            <button className="pill" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
