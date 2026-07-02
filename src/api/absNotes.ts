/**
 * Public + club notes (Phase 4) against the connected server's HearthShelf
 * backend. Same rails as absSocial.ts: /hs/notes on the server's own origin,
 * reached with the per-server ABS bearer token, degrading to a neutral
 * "disabled" envelope on any error (network, 404, older server, admin
 * kill-switch off) so callers can hide the notes UI without special-casing.
 *
 * Spoiler gating is server-side: GET returns full notes only where allowed and
 * anonymous locked stubs ({id,timeSec}) for ahead-notes. See docs/social.md.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSNote, HSNoteStub, HSNotesResponse } from '@hearthshelf/core'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

const NOTES_DISABLED: HSNotesResponse = { enabled: false, notes: [], locked: [], hiddenAhead: 0, now: 0 }

export const notesKeys = {
  list: (serverId: string, libraryItemId: string, clubId: string) =>
    ['notes', serverId, libraryItemId, clubId || 'public'] as const,
}

interface RawNote {
  id?: string
  userId?: string
  username?: string
  libraryItemId?: string
  clubId?: string
  parentId?: string
  timeSec?: number | null
  body?: string
  createdAt?: number
}

interface RawStub {
  id?: string
  timeSec?: number
}

interface RawNotesResponse {
  enabled?: boolean
  notes?: RawNote[]
  locked?: RawStub[]
  hiddenAhead?: number
  now?: number
}

function mapNote(n: RawNote): HSNote {
  return {
    id: n.id ?? '',
    userId: n.userId ?? '',
    username: n.username ?? '',
    libraryItemId: n.libraryItemId ?? '',
    clubId: n.clubId ?? '',
    parentId: n.parentId ?? '',
    timeSec: n.timeSec ?? null,
    body: n.body ?? '',
    createdAt: n.createdAt ?? 0,
  }
}

function mapStub(s: RawStub): HSNoteStub {
  return { id: s.id ?? '', timeSec: s.timeSec ?? 0 }
}

export interface GetNotesOptions {
  clubId?: string
  position?: number
  after?: number
  finished?: boolean
}

/**
 * Fetch notes for a book (public scope by default, or a club's scope for that
 * book). `position` drives the server-side spoiler gate; `after` requests a
 * cheap delta (only notes newer than that created_at) for poll refreshes.
 * Degrades to { enabled: false } on any failure so callers hide the section.
 */
export async function getNotes(
  t: AbsTarget,
  libraryItemId: string,
  opts: GetNotesOptions = {},
): Promise<HSNotesResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return NOTES_DISABLED
  try {
    const qs = new URLSearchParams({ libraryItemId })
    if (opts.clubId) qs.set('clubId', opts.clubId)
    if (opts.position != null) qs.set('position', String(opts.position))
    if (opts.after != null) qs.set('after', String(opts.after))
    if (opts.finished != null) qs.set('finished', String(opts.finished))
    const res = await fetch(`${origin(t)}/hs/notes?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return NOTES_DISABLED
    const data = (await res.json()) as RawNotesResponse
    if (!data || data.enabled !== true) return NOTES_DISABLED
    return {
      enabled: true,
      notes: (data.notes ?? []).map(mapNote),
      locked: (data.locked ?? []).map(mapStub),
      hiddenAhead: data.hiddenAhead ?? 0,
      now: data.now ?? Date.now(),
    }
  } catch {
    return NOTES_DISABLED
  }
}

export interface CreateNoteInput {
  libraryItemId: string
  clubId?: string
  parentId?: string
  timeSec?: number
  body: string
}

/** Post a new note or reply. Throws on failure - caller shows an error toast. */
export async function createNote(t: AbsTarget, input: CreateNoteInput): Promise<HSNote> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`notes ${res.status}`)
  return mapNote((await res.json()) as RawNote)
}

/** Soft-delete a note (author, club owner in their own club, or admin). */
export async function deleteNote(t: AbsTarget, noteId: string): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`notes delete ${res.status}`)
}
