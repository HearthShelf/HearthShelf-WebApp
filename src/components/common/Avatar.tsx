/**
 * A user avatar with a graceful initials fallback.
 *
 * Two modes:
 *  - Pass `target` + `userId` for any signed-in-and-connected user (yourself
 *    included): the photo is served by that server's HearthShelf backend at
 *    GET /hs/avatars/:userId, which ranks uploaded -> Gravatar -> synced Clerk
 *    photo -> initials. This is the source of truth - prefer it whenever a
 *    server connection exists, even for "me".
 *  - Pass `imageUrl` (Clerk's hosted avatar) ONLY where no server session
 *    exists yet, e.g. the remembered-accounts switcher roster (other Clerk
 *    identities on this device you haven't switched into).
 * Either way we render initials first and reveal the image only once it actually
 * loads, so a missing/slow avatar never flashes a broken image.
 */
import { useState, type CSSProperties } from 'react'
import { serverAvatarUrl } from '@/api/avatars'
import type { AbsTarget } from '@/api/absLibrary'

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
  /** Clerk's hosted avatar URL (user.imageUrl); the fast path for "me". */
  imageUrl?: string | null
  /** A connected server; with `userId`, sources the photo from its HS backend. */
  target?: AbsTarget | null
  /** The user's ABS id on `target`, for the server photo route. */
  userId?: string
  /**
   * Cache-bust the server photo URL. The route's response can change without
   * the underlying file changing (e.g. toggling the Gravatar preference, or a
   * fresh Clerk sync), and the GET has a 5-minute Cache-Control - pass a value
   * that changes whenever that user's resolved photo might have (an upload's
   * own version, or a settings `meta` timestamp for "my own" avatar).
   */
  version?: number | string
  size?: number
  className?: string
  /** Merged onto the outer span, e.g. a ring `boxShadow` for stacked avatars. */
  style?: CSSProperties
}

export function Avatar({
  name,
  imageUrl,
  target,
  userId,
  version,
  size = 36,
  className,
  style,
}: AvatarProps) {
  // Resolve the source: the server-stored photo wins whenever we have a
  // target + userId; Clerk's imageUrl is only a fallback for pre-connection
  // contexts (the account switcher); otherwise initials only.
  const src = (target && userId ? serverAvatarUrl(target, userId, version) : null) || imageUrl || null

  // Track load state per source identity. When `src` changes the <img> remounts
  // (keyed), so a stale success never bleeds onto a new src.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const loaded = !!src && loadedSrc === src

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
        ...style,
      }}
    >
      {!loaded && initials(name)}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          onLoad={() => setLoadedSrc(src)}
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
