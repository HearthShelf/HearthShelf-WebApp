/**
 * App-connection scopes, for the Worker.
 *
 * WHY THIS IS DUPLICATED FROM @hearthshelf/core. The canonical definition lives
 * in core (src/lib/appScopes.ts) and is what the SPA, the box, and mobile import.
 * The control plane is a SEPARATE npm package deployed standalone by wrangler -
 * it has no core alias and no submodule of its own, and wiring one in would drag
 * a bundler dependency into a Worker that currently has none.
 *
 * The duplication is deliberate and bounded: a five-entry closed set plus two
 * pure string helpers, no logic that can drift meaningfully. If you change the
 * scope set, change it in BOTH places - core is the source of truth, and the
 * user-facing descriptions live only there (the Worker never renders consent
 * copy; it hands scope tokens to the SPA, which reads core for the words).
 */

/** A scope a third-party app can request. Server-wide, coarse by design. */
export type AppScope =
  | 'library:read'
  | 'library:write'
  | 'progress:read'
  | 'progress:write'
  | 'admin'

export const APP_SCOPES: readonly AppScope[] = [
  'library:read',
  'library:write',
  'progress:read',
  'progress:write',
  'admin',
] as const

export function isAppScope(value: unknown): value is AppScope {
  return typeof value === 'string' && (APP_SCOPES as readonly string[]).includes(value)
}

/**
 * Parse a scope list (OAuth space-delimited, or an array) into validated scopes,
 * returning unknown entries separately rather than throwing: registration must
 * REJECT an unknown scope naming the offender, while other call sites want to
 * ignore it. Same parse, different policy at the call site.
 */
export function parseAppScopes(input: string | readonly string[] | null | undefined): {
  scopes: AppScope[]
  unknown: string[]
} {
  const raw =
    typeof input === 'string' ? input.split(/[\s,]+/) : Array.isArray(input) ? input : []
  const scopes: AppScope[] = []
  const unknown: string[] = []
  for (const entry of raw) {
    const trimmed = String(entry ?? '').trim()
    if (!trimmed) continue
    if (isAppScope(trimmed)) {
      if (!scopes.includes(trimmed)) scopes.push(trimmed)
    } else if (!unknown.includes(trimmed)) {
      unknown.push(trimmed)
    }
  }
  return { scopes, unknown }
}

export function formatAppScopes(scopes: readonly AppScope[]): string {
  return scopes.join(' ')
}

/** Is `requested` fully covered by `granted`? Drives the re-consent check. */
export function scopesCovered(
  granted: readonly AppScope[],
  requested: readonly AppScope[],
): boolean {
  return requested.every((s) => granted.includes(s) || granted.includes('admin'))
}
