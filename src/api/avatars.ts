/**
 * Profile-photo URLs + the Clerk-photo copy into a connected server's store.
 *
 * The hosted front door shows the signed-in user's own photo straight from Clerk
 * (freshest, no round-trip). But OTHER users - on the leaderboard and finished-by
 * chips - can't be reached through Clerk, so their photos must be served by the
 * connected server's HearthShelf backend at GET /hs/avatars/:userId (uploaded ->
 * Gravatar -> synced Clerk photo -> initials, ranked server-side).
 *
 * For a user's SSO photo to reach that chain, we copy the bytes into the server's
 * store with PUT /hs/avatars/:userId and the header X-Avatar-Source: clerk, so it
 * ranks as a synced photo (below a real upload, never overwriting one). We reach
 * the backend exactly like absSocial.ts: the server origin + per-server ABS bearer.
 */
import { getAbsToken } from '@/lib/absTokens'
import { HS_ENDPOINTS } from '@hearthshelf/core'
import type { AbsTarget } from './absLibrary'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

/**
 * The GET URL for a user's photo on a connected server, with an optional cache
 * bust. Used to render OTHER users (initials fallback handled by <Avatar>).
 */
export function serverAvatarUrl(t: AbsTarget, userId: string, version?: number): string {
  const base = `${origin(t)}${HS_ENDPOINTS.avatar(encodeURIComponent(userId))}`
  return version != null ? `${base}?v=${version}` : base
}

// Fetch a remote image URL (Clerk's CDN) and re-encode it to a small square webp,
// matching what the backend expects (a client-resized ~256px square). Returns null
// if the image can't be loaded or the canvas is tainted (non-CORS response).
async function toSquareWebp(imageUrl: string, size = 256): Promise<Blob | null> {
  try {
    const res = await fetch(imageUrl, { mode: 'cors' })
    if (!res.ok) return null
    const srcBlob = await res.blob()
    const bitmap = await createImageBitmap(srcBlob)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Cover-crop: scale the shorter side to fill, center the overflow.
    const scale = Math.max(size / bitmap.width, size / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
    bitmap.close()
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.9))
  } catch {
    return null
  }
}

/**
 * Copy a user's Clerk photo into a connected server's avatar store as a synced
 * ('clerk') photo. Best-effort: returns true only on a confirmed store, false on
 * any failure OR when the server kept an existing manual upload (skipped). The
 * `absUserId` must be the user's ABS id ON THAT server (from getMe), not the
 * Clerk id - the store keys by ABS user id.
 */
export async function syncClerkAvatar(
  t: AbsTarget,
  absUserId: string,
  imageUrl: string,
): Promise<boolean> {
  const token = getAbsToken(t.serverId)
  if (!token) return false
  const blob = await toSquareWebp(imageUrl)
  if (!blob || !blob.size) return false
  try {
    const res = await fetch(`${origin(t)}${HS_ENDPOINTS.avatar(encodeURIComponent(absUserId))}`, {
      method: 'PUT',
      headers: {
        'Content-Type': blob.type || 'image/webp',
        Authorization: `Bearer ${token}`,
        'X-Avatar-Source': 'clerk',
        Accept: 'application/json',
      },
      body: blob,
    })
    if (!res.ok) return false
    const data = (await res.json().catch(() => null)) as { ok?: boolean; skipped?: boolean } | null
    return Boolean(data?.ok) && !data?.skipped
  } catch {
    return false
  }
}
