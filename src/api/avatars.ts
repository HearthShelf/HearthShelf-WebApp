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
export function serverAvatarUrl(t: AbsTarget, userId: string, version?: number | string): string {
  const base = `${origin(t)}${HS_ENDPOINTS.avatar(encodeURIComponent(userId))}`
  return version != null ? `${base}?v=${version}` : base
}

export type AvatarSyncResult = { ok: true } | { ok: false; reason: AvatarSyncFailReason }

export type AvatarSyncFailReason =
  | 'no_photo' // Clerk has no imageUrl to copy
  | 'fetch_failed' // couldn't fetch imageUrl (network/CORS/non-2xx)
  | 'encode_failed' // fetched but couldn't decode/re-encode it
  | 'no_token' // no ABS bearer for this server
  | 'no_abs_user' // getMe() didn't resolve an ABS user id
  | 'request_failed' // the PUT itself failed (network/non-2xx)
  | 'server_skipped' // server kept an existing manual upload

// Fetch a remote image URL (Clerk's CDN) and re-encode it to a small square webp,
// matching what the backend expects (a client-resized ~256px square).
async function toSquareWebp(
  imageUrl: string,
  size = 256,
): Promise<{ ok: true; blob: Blob } | { ok: false; reason: 'fetch_failed' | 'encode_failed' }> {
  let res: Response
  try {
    res = await fetch(imageUrl, { mode: 'cors' })
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  }
  if (!res.ok) return { ok: false, reason: 'fetch_failed' }
  try {
    const srcBlob = await res.blob()
    const bitmap = await createImageBitmap(srcBlob)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'encode_failed' }
    // Cover-crop: scale the shorter side to fill, center the overflow.
    const scale = Math.max(size / bitmap.width, size / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
    )
    if (!blob || !blob.size) return { ok: false, reason: 'encode_failed' }
    return { ok: true, blob }
  } catch {
    // A CORS-tainted canvas throws a SecurityError on toBlob/getImageData.
    return { ok: false, reason: 'encode_failed' }
  }
}

/**
 * Copy a user's Clerk photo into a connected server's avatar store as a synced
 * ('clerk') photo. Best-effort: resolves `{ok:true}` only on a confirmed store,
 * `{ok:false, reason}` on any failure OR when the server kept an existing manual
 * upload (skipped). The `absUserId` must be the user's ABS id ON THAT server
 * (from getMe), not the Clerk id - the store keys by ABS user id.
 */
export async function syncClerkAvatar(
  t: AbsTarget,
  absUserId: string,
  imageUrl: string,
): Promise<AvatarSyncResult> {
  const token = getAbsToken(t.serverId)
  if (!token) return { ok: false, reason: 'no_token' }
  const encoded = await toSquareWebp(imageUrl)
  if (!encoded.ok) return encoded
  try {
    const res = await fetch(`${origin(t)}${HS_ENDPOINTS.avatar(encodeURIComponent(absUserId))}`, {
      method: 'PUT',
      headers: {
        'Content-Type': encoded.blob.type || 'image/webp',
        Authorization: `Bearer ${token}`,
        'X-Avatar-Source': 'clerk',
        Accept: 'application/json',
      },
      body: encoded.blob,
    })
    if (!res.ok) return { ok: false, reason: 'request_failed' }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; skipped?: boolean } | null
    if (!data?.ok) return { ok: false, reason: 'request_failed' }
    if (data.skipped) return { ok: false, reason: 'server_skipped' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'request_failed' }
  }
}

export type AvatarProbeResult =
  | { state: 'stored' } // a 200: an upload or synced Clerk photo (no way to tell which from here)
  | { state: 'gravatar_redirect' } // a 302 to Gravatar
  | { state: 'none' } // a 404 - the client falls back to initials
  | { state: 'unknown'; detail: string } // network error or unexpected status

/**
 * Diagnostics only: classify what the GET route currently resolves to for a
 * user, without downloading or rendering the image. Used by the Account page's
 * Advanced panel to explain a missing avatar - the route's Cache-Control means
 * this can still reflect a stale answer for up to 5 minutes after a change.
 */
export async function probeAvatarSource(t: AbsTarget, userId: string): Promise<AvatarProbeResult> {
  try {
    const res = await fetch(serverAvatarUrl(t, userId, Date.now()), { redirect: 'manual' })
    // A manual-redirect fetch of a cross-origin 3xx resolves as an opaque
    // response with status 0 - we can't see the Location, only that it redirected.
    if (res.type === 'opaqueredirect' || res.status === 302) return { state: 'gravatar_redirect' }
    if (res.status === 200) return { state: 'stored' }
    if (res.status === 404) return { state: 'none' }
    return { state: 'unknown', detail: `HTTP ${res.status}` }
  } catch (err) {
    return { state: 'unknown', detail: err instanceof Error ? err.message : 'network error' }
  }
}

/**
 * Clear a user's stored avatar on a connected server (upload or synced Clerk
 * copy alike). Used to break a stuck `server_skipped` state where an old manual
 * upload is blocking the Clerk photo from syncing. Returns false on any failure.
 */
export async function deleteServerAvatar(t: AbsTarget, absUserId: string): Promise<boolean> {
  const token = getAbsToken(t.serverId)
  if (!token) return false
  try {
    const res = await fetch(`${origin(t)}${HS_ENDPOINTS.avatar(encodeURIComponent(absUserId))}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}
