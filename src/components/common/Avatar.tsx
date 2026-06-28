/**
 * A user avatar with a graceful initials fallback.
 *
 * In the hosted front door the user identity is Clerk, not the HS server - so
 * the photo comes from `imageUrl` (Clerk's hosted avatar) rather than an HS
 * backend endpoint. We render initials first and reveal the image only once it
 * actually loads, so a missing/slow avatar never flashes a broken image.
 */
import { useState } from 'react'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// A stable accent color per name, so initials fallbacks are distinguishable and
// consistent across the app (same name -> same color).
function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff
  }
  const hue = hash % 360
  return `hsl(${hue} 42% 38%)`
}

interface AvatarProps {
  name: string
  /** Clerk's hosted avatar URL (user.imageUrl); omit for initials-only. */
  imageUrl?: string | null
  size?: number
  className?: string
}

export function Avatar({ name, imageUrl, size = 36, className }: AvatarProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        overflow: 'hidden',
        position: 'relative',
        background: colorFor(name),
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.round(size * 0.36),
        userSelect: 'none',
      }}
    >
      {!loaded && initials(name)}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          onLoad={() => setLoaded(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
    </span>
  )
}
