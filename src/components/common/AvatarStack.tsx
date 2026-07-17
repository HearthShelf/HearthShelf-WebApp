import type { AbsTarget } from '@/api/absLibrary'
import { Avatar } from '@/components/common/Avatar'

export interface StackUser {
  userId: string
  username: string
  /** 'reading' readers get a marker distinguishing them from finishers. */
  status?: 'finished' | 'reading'
}

interface AvatarStackProps {
  users: StackUser[]
  /** The connected server, so each avatar sources its server-stored photo. */
  target: AbsTarget | null
  /** How many faces before collapsing the rest into a +N chip. */
  max?: number
  size?: number
  /** Ring color drawn around each avatar so overlapping faces stay separated;
   * pass the surrounding surface color. */
  ring?: string
  /** Optional trailing caption (e.g. "Finished by 5 people"). */
  label?: string
}

/**
 * Overlapping cluster of reader avatars with a +N overflow chip, for showing
 * who has read a book on library/browse cards and detail pages. Wraps the shared
 * Avatar so each face resolves its server-stored photo (falling back to initials).
 * In-progress readers ('reading') carry a small accent dot so they read as
 * distinct from finishers. Renders nothing when there are no users.
 */
export function AvatarStack({
  users,
  target,
  max = 4,
  size = 26,
  ring = 'var(--background)',
  label,
}: AvatarStackProps) {
  if (!users.length) return null
  const shown = users.slice(0, max)
  const extra = users.length - shown.length
  const names = users.map((u) => `${u.username}${u.status === 'reading' ? ' (reading)' : ''}`).join(', ')
  // The in-progress dot scales with the avatar but stays legible on small tiles.
  const dot = Math.max(6, Math.round(size * 0.32))

  return (
    <div className="avatar-stack" title={names}>
      {shown.map((u) =>
        u.status === 'reading' ? (
          <span key={u.userId} className="hs-avatar-wrap">
            <Avatar
              name={u.username}
              target={target}
              userId={u.userId}
              size={size}
              className="hs-avatar"
              style={{ boxShadow: `0 0 0 2px ${ring}` }}
            />
            <span
              className="reading-dot"
              title={`${u.username} is reading this`}
              style={{ width: dot, height: dot, boxShadow: `0 0 0 2px ${ring}` }}
            />
          </span>
        ) : (
          <Avatar
            key={u.userId}
            name={u.username}
            target={target}
            userId={u.userId}
            size={size}
            className="hs-avatar"
            style={{ boxShadow: `0 0 0 2px ${ring}` }}
          />
        ),
      )}
      {extra > 0 && (
        <span
          className="avatar-more"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.4),
            boxShadow: `0 0 0 2px ${ring}`,
          }}
        >
          +{extra}
        </span>
      )}
      {label && <span className="as-label">{label}</span>}
    </div>
  )
}
