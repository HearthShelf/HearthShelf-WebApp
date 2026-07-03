/**
 * QuestGiver client against the connected server's HearthShelf backend.
 *
 * Like absSocial.ts (the leaderboard) and absRequests.ts, these endpoints live
 * under /hs/questgiver/* on the connected server's own origin and are served by
 * the HearthShelf Node backend (NOT the ABS-native /api/* surface). We reach them
 * the same way absClient does: the server's public origin + the per-server ABS
 * bearer token.
 *
 * The /hs/questgiver/config payload is SHARED: it gates BOTH QuestGiver and the
 * Discover surface (featureEnabled + discoverEnabled). There is no separate
 * /hs/discover/config endpoint.
 *
 * Every call degrades gracefully: on any error the recommendation flow falls back
 * to the deterministic heuristic (no backend needed), and the config falls back to
 * "feature on, AI off" so the flow still works in local dev. Shapes mirror
 * HearthShelf's own questgiver.ts.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import {
  qgHeuristic,
  qgCraftPrompt,
  type QgProfile,
  type QgAnswers,
  type QgCandidate,
  type QgResult,
  type QgRenderedPick,
  type HSQuestGiverConfig,
  type HSQuestGiverConfigEnvLocks,
  type HSQuestGiverAdminConfig,
  type HSQuestGiverAdminConfigUpdate,
} from '@hearthshelf/core'

// The shared QuestGiver + Discover config. featureEnabled gates QuestGiver,
// discoverEnabled gates the Discover surface; both default-enabled (see below).
// Canonical shape now lives in @hearthshelf/core.
export type QgConfig = HSQuestGiverConfig

// Per-field env locks: true = the value is pinned by an environment variable, so
// it overrides the database and is read-only in the UI.
export type QgEnvLocks = HSQuestGiverConfigEnvLocks

export type QgAdminConfig = HSQuestGiverAdminConfig

export type QgAdminConfigPatch = HSQuestGiverAdminConfigUpdate

// Client-only persistence shapes (run history + feedback live in localStorage,
// mirrored best-effort to the backend so history follows the user across
// devices). This is the concrete client display shape (see QuestGiverPage) - it
// is intentionally richer than the loose core HSQuestGiverRun round-trip type.
export interface QgRun {
  id: string
  label: string
  when: string // human-readable timestamp, stamped at save time
  engine: 'ai' | 'heuristic'
  intro: string
  picks: QgRenderedPick[]
}
export interface QgFeedback {
  vote?: 1 | -1
  note?: string
}

// Config fallback: feature ON, AI OFF. Mirrors HS's catch fallback - the
// heuristic flow works without the backend, and both surfaces stay visible.
const CONFIG_FALLBACK: QgConfig = {
  featureEnabled: true,
  discoverEnabled: true,
  enabled: false,
  provider: null,
  model: null,
  limit: null,
  remaining: null,
  period: null,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

// Low-level fetch against /hs/questgiver/* with the per-server ABS bearer token.
// Throws on any non-ok response or missing token so callers can map to a safe
// default.
async function qgFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/questgiver${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`QG ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * The SHARED QuestGiver + Discover config. Returns the feature-on / AI-off
 * fallback on any failure so both surfaces default to enabled and the heuristic
 * flow keeps working (matches the self-hosted app's default-enabled semantics).
 */
export async function getQgConfig(t: AbsTarget): Promise<QgConfig> {
  try {
    const data = await qgFetch<Partial<QgConfig>>(t, '/config')
    return {
      featureEnabled: data.featureEnabled !== false,
      discoverEnabled: data.discoverEnabled !== false,
      enabled: data.enabled === true,
      provider: data.provider ?? null,
      model: data.model ?? null,
      limit: data.limit ?? null,
      remaining: data.remaining ?? null,
      period: data.period ?? null,
    }
  } catch {
    return CONFIG_FALLBACK
  }
}

// --- Admin: editable AI config (provider/model/key/limit/enabled) ------------

export async function getQgAdminConfig(t: AbsTarget): Promise<QgAdminConfig> {
  return qgFetch<QgAdminConfig>(t, '/admin/config')
}

export async function saveQgAdminConfig(
  t: AbsTarget,
  patch: QgAdminConfigPatch,
): Promise<QgAdminConfig> {
  return qgFetch<QgAdminConfig>(t, '/admin/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

// --- Recommendation -----------------------------------------------------------

// Get a recommendation. Tries the AI backend; on any failure (unconfigured,
// rate-limited, provider error, network, missing token) falls back to the local
// heuristic - deterministic, no backend needed.
export async function qgRecommend(
  t: AbsTarget | null,
  profile: QgProfile,
  answers: QgAnswers,
  candidates: QgCandidate[],
): Promise<QgResult & { remaining?: number | null }> {
  if (t) {
    try {
      const prompt = qgCraftPrompt(profile, answers, candidates)
      const data = await qgFetch<{
        intro: string
        picks: { id: string; reason: string }[]
        newPicks: { title: string; author: string; genre: string; hours: number; reason: string }[]
        remaining?: number | null
      }>(t, '/recommend', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      return {
        intro: data.intro,
        picks: data.picks,
        newPicks: data.newPicks ?? [],
        engine: 'ai',
        remaining: data.remaining ?? null,
      }
    } catch {
      // fall through to heuristic
    }
  }
  return { ...qgHeuristic(profile, answers, candidates), engine: 'heuristic' }
}

// --- Client-only persistence (run history, feedback) -------------------------

const RUNS_KEY = 'hs_qg_runs'
const FEEDBACK_KEY = 'hs_qg_feedback'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / disabled - non-fatal */
  }
}

export function getRuns(): QgRun[] {
  return read<QgRun[]>(RUNS_KEY, [])
}

export function saveRun(t: AbsTarget | null, run: QgRun): QgRun[] {
  const runs = [run, ...getRuns()].slice(0, 30) // cap at 30
  write(RUNS_KEY, runs)
  // Mirror to the server so history follows the user across devices. Best
  // effort - localStorage already holds it if the backend is unreachable.
  if (t) {
    qgFetch(t, '/runs', { method: 'POST', body: JSON.stringify({ run }) }).catch(() => {})
  }
  return runs
}

// Pull the server-side run history (cross-device). Falls back to the local cache
// when the backend is unreachable.
export async function fetchServerRuns(t: AbsTarget | null): Promise<QgRun[]> {
  if (t) {
    try {
      const data = await qgFetch<{ runs: QgRun[] }>(t, '/runs')
      if (Array.isArray(data.runs)) {
        write(RUNS_KEY, data.runs.slice(0, 30))
        return data.runs
      }
    } catch {
      /* offline - keep the local cache */
    }
  }
  return getRuns()
}

export function getFeedback(): Record<string, QgFeedback> {
  return read<Record<string, QgFeedback>>(FEEDBACK_KEY, {})
}

export function setFeedback(key: string, fb: QgFeedback): Record<string, QgFeedback> {
  const all = getFeedback()
  all[key.toLowerCase()] = { ...all[key.toLowerCase()], ...fb }
  write(FEEDBACK_KEY, all)
  return all
}
