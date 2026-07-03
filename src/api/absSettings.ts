/**
 * Per-key settings sync against the active server's HearthShelf backend
 * (/hs/settings). Like absSocial.ts / absHosted.ts, this lives on the connected
 * server's own origin and is served by the HearthShelf Node backend, reached
 * with the server's public origin + the per-server ABS bearer token. Settings
 * are keyed server-side by (server_id, user_id), so browsing a different server
 * naturally gives that server's settings.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'
import type {
  StoredSetting,
  SettingChange,
  SettingsPullResult,
  SettingsPushResult,
} from '@hearthshelf/core'

// Canonical `/hs/settings` shapes now come from @hearthshelf/core; re-exported
// and aliased so existing importers keep working unchanged.
export type { StoredSetting, SettingChange }
export type ServerSettings = SettingsPullResult
export type PushResult = SettingsPushResult

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function settingsFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no_token')
  const res = await fetch(`${origin(t)}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`settings ${res.status}`)
  return res.json() as Promise<T>
}

// Pull account + device (for this device) settings and the non-secret connection.
export function getServerSettings(t: AbsTarget, deviceId: string): Promise<ServerSettings> {
  const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
  return settingsFetch<ServerSettings>(t, `/hs/settings${q}`)
}

// Push a batch of changed keys. The server validates + applies per-key LWW and
// reports which landed / were stale / failed validation.
export function putServerSettings(
  t: AbsTarget,
  deviceId: string,
  changes: SettingChange[],
): Promise<PushResult> {
  return settingsFetch<PushResult>(t, '/hs/settings', {
    method: 'PUT',
    body: JSON.stringify({ deviceId, changes }),
  })
}
