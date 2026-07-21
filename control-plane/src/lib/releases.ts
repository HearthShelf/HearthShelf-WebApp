/**
 * Latest-release tracking. The control plane's source of truth for "what is the
 * newest HearthShelf" is the GitHub Releases API - the release workflow tags
 * v*.*.* which publishes GHCR images + a GitHub Release, so the latest release IS
 * the latest version. We poll it on a cron (see index.ts scheduled handler),
 * cache the result in D1, and serve it to the SPA at GET /releases/latest.
 *
 * A platform admin can override the cached row (POST /admin/releases) to escalate
 * severity (flag a security fix), set a min_supported floor, or pin a version;
 * a pinned row's severity/floor survive the next cron refresh.
 */
import type { Env } from '../types'
import { now } from './ids'

/** The GitHub repo the release workflow publishes to. */
const GITHUB_REPO = 'HearthShelf/HearthShelf'
const LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
/** The mobile app repo. Its release workflow pushes bare version tags (0.0.8) that
 *  publish to Play/TestFlight - there is no GitHub Release object - so the mobile
 *  refresh reads the public tags API instead of the releases API. */
const MOBILE_REPO = 'HearthShelf/HearthShelf-Mobile'
const MOBILE_TAGS_URL = `https://api.github.com/repos/${MOBILE_REPO}/tags?per_page=100`
/** Refresh from GitHub at most this often on a lazy read (the cron runs every 6h
 *  independently; this only backstops a fresh deploy before the first cron). */
const LAZY_REFRESH_MS = 6 * 60 * 60 * 1000

export type Severity = 'info' | 'recommended' | 'security' | 'critical'
const SEVERITIES: Severity[] = ['info', 'recommended', 'security', 'critical']

export interface ReleaseRow {
  channel: string
  version: string
  severity: Severity
  notes_url: string | null
  published_at: number | null
  min_supported: string | null
  pinned: number
  fetched_at: number
}

/** Strip a leading 'v' and any build/prerelease noise we don't compare on, giving
 *  a bare "x.y.z". Returns '' if nothing numeric is present. */
export function normalizeVersion(tag: string): string {
  const m = String(tag)
    .trim()
    .replace(/^v/i, '')
    .match(/^\d+(\.\d+){0,2}/)
  return m ? m[0] : ''
}

/**
 * Compare two semver-ish strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Missing minor/patch count as 0 ("1.2" == "1.2.0"). Non-numeric input sorts low.
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map(Number)
  const pb = normalizeVersion(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** True when `current` is strictly older than `latest`. Empty/unknown current is
 *  treated as up-to-date (we never nag a box whose version we can't read). */
export function isOutdated(current: string | null | undefined, latest: string): boolean {
  const c = normalizeVersion(current || '')
  if (!c) return false
  return compareSemver(c, latest) < 0
}

/**
 * Pull the severity out of a GitHub release body. Convention: a line reading
 * `Severity: security` (case-insensitive) in the release notes. Absent -> the
 * default for a normal release. A prerelease defaults to 'info' (opt-in only).
 */
function parseSeverity(body: string | null, prerelease: boolean): Severity {
  const m = /^\s*severity:\s*(info|recommended|security|critical)\s*$/im.exec(body || '')
  if (m) return m[1].toLowerCase() as Severity
  return prerelease ? 'info' : 'recommended'
}

export type Channel = 'stable' | 'mobile'

export async function getLatestRelease(env: Env, channel: Channel = 'stable'): Promise<ReleaseRow | null> {
  return env.DB.prepare(`SELECT * FROM releases WHERE channel = ?`).bind(channel).first<ReleaseRow>()
}

/**
 * Fetch the newest GitHub release and cache it. Best-effort: any failure (rate
 * limit, network, no releases yet) leaves the existing cached row untouched and
 * resolves without throwing, so it is safe to call from a request path or cron.
 *
 * A pinned row (admin override) keeps its severity + min_supported; only the
 * version / notes / published_at / fetched_at refresh, so a manual security
 * escalation is not reverted by the next poll.
 */
export async function refreshLatestRelease(env: Env): Promise<ReleaseRow | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hearthshelf-control-plane',
    }
    // A token lifts the 60/hr unauthenticated rate limit; optional.
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`

    const res = await fetch(LATEST_URL, { headers })
    if (!res.ok) return getLatestRelease(env)
    const data = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
      body?: string | null
      published_at?: string | null
      prerelease?: boolean
    }
    const version = normalizeVersion(data.tag_name || data.name || '')
    if (!version) return getLatestRelease(env)

    const existing = await getLatestRelease(env)
    const pinned = existing?.pinned === 1
    const severity = pinned ? existing!.severity : parseSeverity(data.body ?? null, !!data.prerelease)
    const minSupported = pinned ? existing!.min_supported : null
    const publishedAt = data.published_at ? Date.parse(data.published_at) : null

    await env.DB.prepare(
      `INSERT INTO releases
         (channel, version, severity, notes_url, published_at, min_supported, pinned, fetched_at)
       VALUES ('stable', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel) DO UPDATE SET
         version = excluded.version,
         severity = excluded.severity,
         notes_url = excluded.notes_url,
         published_at = excluded.published_at,
         min_supported = excluded.min_supported,
         fetched_at = excluded.fetched_at`,
    )
      .bind(
        version,
        severity,
        data.html_url ?? null,
        Number.isFinite(publishedAt as number) ? publishedAt : null,
        minSupported,
        pinned ? 1 : 0,
        now(),
      )
      .run()
    return getLatestRelease(env)
  } catch {
    return getLatestRelease(env)
  }
}

/** Read the cached release, refreshing first if the cache is empty or stale.
 *  Used by the public read so a freshly deployed CP has data before the first cron. */
export async function getLatestReleaseFresh(env: Env): Promise<ReleaseRow | null> {
  const row = await getLatestRelease(env)
  if (!row || now() - row.fetched_at > LAZY_REFRESH_MS) {
    return refreshLatestRelease(env)
  }
  return row
}

/**
 * Fetch the newest HearthShelf-Mobile version and cache it under channel
 * 'mobile'. The mobile release workflow only pushes a bare tag (0.0.8) - Play and
 * TestFlight are the publish targets, there is no GitHub Release - so this reads
 * the tags API and takes the highest stable semver. Pre-release tags (anything
 * with a '-' label, e.g. 0.1.0-beta.1) are skipped: they ship to testers under a
 * distinct runtimeVersion and must never advance the fleet-wide "latest".
 *
 * Same contract as refreshLatestRelease: best-effort (failures keep the cached
 * row), and a pinned row keeps its admin-set severity + min_supported.
 */
export async function refreshLatestMobileRelease(env: Env): Promise<ReleaseRow | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hearthshelf-control-plane',
    }
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`

    const res = await fetch(MOBILE_TAGS_URL, { headers })
    if (!res.ok) return getLatestRelease(env, 'mobile')
    const tags = (await res.json()) as Array<{ name?: string }>
    let latest = ''
    for (const t of tags) {
      const raw = String(t?.name ?? '').trim()
      // Skip pre-release tags entirely; normalizeVersion would strip the label
      // and a beta tag would masquerade as its final version.
      if (!raw || raw.includes('-')) continue
      const v = normalizeVersion(raw)
      if (v && (!latest || compareSemver(v, latest) > 0)) latest = v
    }
    if (!latest) return getLatestRelease(env, 'mobile')

    const existing = await getLatestRelease(env, 'mobile')
    const pinned = existing?.pinned === 1
    // A tag carries no severity convention (no release body to parse); default
    // to the soft nudge and let the admin override escalate when needed.
    const severity: Severity = pinned ? existing!.severity : 'recommended'
    const minSupported = pinned ? existing!.min_supported : null

    await env.DB.prepare(
      `INSERT INTO releases
         (channel, version, severity, notes_url, published_at, min_supported, pinned, fetched_at)
       VALUES ('mobile', ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT (channel) DO UPDATE SET
         version = excluded.version,
         severity = excluded.severity,
         notes_url = excluded.notes_url,
         min_supported = excluded.min_supported,
         fetched_at = excluded.fetched_at`,
    )
      .bind(latest, severity, 'https://hearthshelf.com/changelog', minSupported, pinned ? 1 : 0, now())
      .run()
    return getLatestRelease(env, 'mobile')
  } catch {
    return getLatestRelease(env, 'mobile')
  }
}

/** Mobile counterpart of getLatestReleaseFresh: lazy-refresh backstop for a
 *  fresh deploy before the first cron. */
export async function getLatestMobileReleaseFresh(env: Env): Promise<ReleaseRow | null> {
  const row = await getLatestRelease(env, 'mobile')
  if (!row || now() - row.fetched_at > LAZY_REFRESH_MS) {
    return refreshLatestMobileRelease(env)
  }
  return row
}

/**
 * Admin override. Merges the provided fields onto the cached row (creating it if
 * absent), marks it pinned so the cron won't revert severity/floor, and returns
 * the new row. `version` defaults to whatever is cached (you usually only pin a
 * severity or floor, not invent a version).
 */
export async function setReleaseOverride(
  env: Env,
  patch: {
    version?: string
    severity?: string
    minSupported?: string | null
    notesUrl?: string | null
  },
  channel: Channel = 'stable',
): Promise<ReleaseRow | null> {
  const existing = await getLatestRelease(env, channel)
  const version = patch.version ? normalizeVersion(patch.version) : existing?.version
  if (!version) return null
  const severity: Severity =
    patch.severity && SEVERITIES.includes(patch.severity as Severity)
      ? (patch.severity as Severity)
      : (existing?.severity ?? 'recommended')
  const minSupported =
    patch.minSupported === undefined
      ? (existing?.min_supported ?? null)
      : patch.minSupported
        ? normalizeVersion(patch.minSupported) || null
        : null
  const notesUrl = patch.notesUrl === undefined ? (existing?.notes_url ?? null) : patch.notesUrl

  await env.DB.prepare(
    `INSERT INTO releases
       (channel, version, severity, notes_url, published_at, min_supported, pinned, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (channel) DO UPDATE SET
       version = excluded.version,
       severity = excluded.severity,
       notes_url = excluded.notes_url,
       min_supported = excluded.min_supported,
       pinned = 1,
       fetched_at = excluded.fetched_at`,
  )
    .bind(channel, version, severity, notesUrl, existing?.published_at ?? null, minSupported, now())
    .run()
  return getLatestRelease(env, channel)
}

/** The public DTO the SPA consumes. */
export interface LatestReleaseDTO {
  version: string
  severity: Severity
  notes_url: string | null
  published_at: number | null
  min_supported: string | null
}

export function toDTO(row: ReleaseRow | null): LatestReleaseDTO | null {
  if (!row) return null
  return {
    version: row.version,
    severity: row.severity,
    notes_url: row.notes_url,
    published_at: row.published_at,
    min_supported: row.min_supported,
  }
}
