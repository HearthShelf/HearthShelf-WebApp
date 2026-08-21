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
import type {
  HSNote,
  HSNoteMention,
  HSNoteReaction,
  HSNoteStub,
  HSNotesResponse,
  NoteReactionKind,
  NoteVisibility,
} from '@hearthshelf/core'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

const NOTES_DISABLED: HSNotesResponse = {
  enabled: false,
  notes: [],
  locked: [],
  hiddenAhead: 0,
  now: 0,
}

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
  visibility?: string
  parentId?: string
  timeSec?: number | null
  safe?: boolean
  body?: string
  createdAt?: number
  mentions?: Array<{ userId?: string; username?: string }>
  reactions?: Array<{ kind?: string; count?: number; mine?: boolean }>
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

function asVisibility(v: string | undefined, clubId: string): NoteVisibility {
  if (v === 'club' || v === 'public' || v === 'personal') return v
  // Older servers omit `visibility` - fall back to the pre-visibility overload.
  return clubId ? 'club' : 'public'
}

function mapMentions(raw: RawNote['mentions']): HSNoteMention[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out = raw
    .map((m) => ({ userId: m?.userId ?? '', username: m?.username ?? '' }))
    .filter((m) => m.userId)
  return out.length ? out : undefined
}

/** Tallies as sent, minus anything malformed. An unrecognised kind is KEPT -
 *  the server stores any well-formed kind, and dropping it here would hide a
 *  reaction added by a newer client instead of just showing it plainly. */
function mapReactions(raw: RawNote['reactions']): HSNoteReaction[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out = raw
    .map((r) => ({
      kind: (r?.kind ?? '') as NoteReactionKind,
      count: Number(r?.count ?? 0),
      mine: Boolean(r?.mine),
    }))
    .filter((r) => r.kind && Number.isFinite(r.count) && r.count > 0)
  return out.length ? out : undefined
}

function mapNote(n: RawNote): HSNote {
  const clubId = n.clubId ?? ''
  return {
    id: n.id ?? '',
    userId: n.userId ?? '',
    username: n.username ?? '',
    libraryItemId: n.libraryItemId ?? '',
    clubId,
    visibility: asVisibility(n.visibility, clubId),
    parentId: n.parentId ?? '',
    timeSec: n.timeSec ?? null,
    safe: Boolean(n.safe),
    body: n.body ?? '',
    createdAt: n.createdAt ?? 0,
    mentions: mapMentions(n.mentions),
    reactions: mapReactions(n.reactions),
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
  visibility?: NoteVisibility
  parentId?: string
  timeSec?: number
  safe?: boolean
  body: string
  /** Club member ids the note @mentions. The server re-authorizes every id
   *  against club membership, so this is a request, never a grant. */
  mentions?: string[]
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

/**
 * Add or remove one reaction on a note. `on` is explicit rather than a toggle so
 * a double click converges on the same state instead of flipping twice.
 *
 * Returns the note's fresh tallies, for the caller to reconcile against rather
 * than incrementing a possibly-stale local count.
 */
export async function reactToNote(
  t: AbsTarget,
  noteId: string,
  kind: NoteReactionKind,
  on: boolean,
): Promise<HSNoteReaction[]> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/notes/${encodeURIComponent(noteId)}/reactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ kind, on }),
  })
  if (!res.ok) throw new Error(`notes reactions ${res.status}`)
  const data = (await res.json()) as { reactions?: HSNoteReaction[] }
  return Array.isArray(data.reactions) ? data.reactions : []
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
