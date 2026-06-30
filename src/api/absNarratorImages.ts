/**
 * Narrator photos - a HearthShelf-native feature (ABS has no narrator record).
 * Stored/served by the connected server's HS backend at /hs/narrators/* (one
 * image per narrator NAME, server-wide). We reach it on the server's own origin
 * with the per-server ABS bearer, the same way absSocial/absRequests do.
 *
 * The GET image URL is public on the backend (so <img src> works), but we still
 * append the in-memory token where convenient; uploads/deletes are admin-only and
 * always send the bearer.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

/**
 * Image URL for a narrator's photo, or null with no target. `v` cache-busts after
 * an upload. The GET route is public, so no token is needed in the URL.
 */
export function narratorImageUrl(t: AbsTarget, name: string, v = 0): string {
  return `${origin(t)}/hs/narrators/${encodeURIComponent(name)}/image${v ? `?v=${v}` : ''}`
}

/** Upload (or replace) a narrator's photo. Raw image bytes; admin only. */
export async function uploadNarratorImage(
  t: AbsTarget,
  name: string,
  file: File
): Promise<void> {
  const token = getAbsToken(t.serverId)
  const res = await fetch(`${origin(t)}/hs/narrators/${encodeURIComponent(name)}/image`, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  })
  if (!res.ok) throw new Error(`narrator image upload failed (${res.status})`)
}

/** Remove a narrator's photo. Admin only. */
export async function deleteNarratorImage(t: AbsTarget, name: string): Promise<void> {
  const token = getAbsToken(t.serverId)
  const res = await fetch(`${origin(t)}/hs/narrators/${encodeURIComponent(name)}/image`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`narrator image delete failed (${res.status})`)
  }
}

/**
 * Names of narrators that have an uploaded photo (server-wide). Degrades to an
 * empty set on any failure (e.g. an older box without the /hs/narrators route).
 */
export async function getNarratorImageNames(t: AbsTarget): Promise<Set<string>> {
  try {
    const token = getAbsToken(t.serverId)
    const res = await fetch(`${origin(t)}/hs/narrators/images`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) return new Set()
    const data = (await res.json()) as { names?: string[] }
    // Normalize for membership tests (the server keys by trimmed+lowercased name).
    return new Set((data.names ?? []).map((n) => n.trim().toLowerCase()))
  } catch {
    return new Set()
  }
}
