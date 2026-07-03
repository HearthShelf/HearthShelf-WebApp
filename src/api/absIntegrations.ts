/**
 * Admin integrations config client against the connected server's HearthShelf
 * backend (/hs/integrations/config).
 *
 * Holds the editable connection settings for the external services HearthShelf
 * talks to (ReadMeABook, Audplexus) plus the Audible catalog region. Secrets are
 * never returned by the backend - the GET only reports whether each is set.
 *
 * Reached the same way absSocial.ts is: the connected server's public origin +
 * the per-server ABS bearer token (NOT the ABS-native /api/* surface).
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSIntegrationsConfig, HSIntegrationsEnvLocks } from '@hearthshelf/core'

// Canonical `/hs/integrations/config` shapes now come from @hearthshelf/core;
// aliased to the module's historical local names so callers stay unchanged.
export type IntegrationsEnvLocks = HSIntegrationsEnvLocks
export type IntegrationsConfig = HSIntegrationsConfig

// NOTE: kept local (not core's HSIntegrationsPatch). The admin UI clears the
// non-secret URL fields by sending null, and picks an arbitrary region string
// from the select; core's HSIntegrationsPatch types rmabUrl/audplexusUrl as
// non-null string and audibleRegion as the narrow HSAudibleRegion union, so it
// does not model those two behaviors. See migration report.
export interface IntegrationsConfigPatch {
  rmabUrl?: string | null
  rmabLoginToken?: string | null // omit/'' to keep; null to clear
  audplexusUrl?: string | null
  audplexusKey?: string | null // omit/'' to keep; null to clear
  audibleRegion?: string
}

export const integrationsKeys = {
  config: (serverId: string) => ['integrations', 'config', serverId] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function intFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/integrations${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`integrations ${res.status}`)
  return res.json() as Promise<T>
}

export function getIntegrationsConfig(t: AbsTarget): Promise<IntegrationsConfig> {
  return intFetch<IntegrationsConfig>(t, '/config')
}

export function saveIntegrationsConfig(
  t: AbsTarget,
  patch: IntegrationsConfigPatch,
): Promise<IntegrationsConfig> {
  return intFetch<IntegrationsConfig>(t, '/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
