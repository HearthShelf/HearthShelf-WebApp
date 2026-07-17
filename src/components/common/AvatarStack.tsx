import type { AbsTarget } from '@/api/absLibrary'
import { Avatar } from '@/components/common/Avatar'

export interface StackUser {
  userId: string
  username: string
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
 * "who finished this" on library/browse cards and detail pages. Wraps the shared
 * Avatar so each face resolves its server-stored photo (falling back to initials).
 * Renders nothing when there are no users.
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
  const names = users.map((u) => u.username).join(', ')

  return (
    <div className="avatar-stack" title={names}>
      {shown.map((u) => (
        <Avatar
          key={u.userId}
          name={u.username}
          target={target}
          userId={u.userId}
          size={size}
          className="hs-avatar"
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
        />
      ))}
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
