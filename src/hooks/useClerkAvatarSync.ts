/**
 * Keeps a connected server's copy of the signed-in user's Clerk photo current.
 *
 * The server serves OTHER users their photo from its own store, so a user's SSO
 * photo has to be copied there (see api/avatars.ts). This hook does that copy:
 *   - silently on load / server switch, but only when the Clerk imageUrl CHANGED
 *     since the last sync (a fingerprint in localStorage), so it's near-free; and
 *   - on demand via the returned sync() for a "Sync photo" button.
 *
 * There is no polling and no Clerk webhook - a changed photo propagates the next
 * time the app loads or the user taps the button. Best-effort throughout: a
 * failure never surfaces an error to the user (they still have Gravatar/initials).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { syncClerkAvatar, type AvatarSyncResult } from '@/api/avatars'

// Fingerprint of the last Clerk imageUrl we synced to a given server, so an
// unchanged photo doesn't re-upload on every load. Keyed by server id.
function fpKey(serverId: string): string {
  return `hs:clerk-avatar-fp:${serverId}`
}

export function useClerkAvatarSync(): {
  sync: () => Promise<AvatarSyncResult>
  syncing: boolean
  /**
   * The outcome of the most recent run - auto (on load/server switch) or the
   * manual button - for the Account page's diagnostics. null before the first
   * run resolves. The auto-sync is otherwise silent (see the module doc), so
   * this is the only way to see WHY it didn't sync.
   */
  lastResult: AvatarSyncResult | null
} {
  const { user, isLoaded } = useUser()
  const { target } = useActiveServer()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<AvatarSyncResult | null>(null)
  // Guards against overlapping runs (the auto-effect + a button tap).
  const inFlight = useRef(false)

  const run = useCallback(
    async (force: boolean): Promise<AvatarSyncResult> => {
      if (inFlight.current) return { ok: false, reason: 'request_failed' }
      if (!isLoaded || !user || !target) return { ok: false, reason: 'no_abs_user' }
      const imageUrl = user.imageUrl
      if (!imageUrl) {
        const result: AvatarSyncResult = { ok: false, reason: 'no_photo' }
        setLastResult(result)
        return result
      }
      if (!force && localStorage.getItem(fpKey(target.serverId)) === imageUrl) {
        const result: AvatarSyncResult = { ok: false, reason: 'no_photo' }
        setLastResult(result)
        return result
      }

      inFlight.current = true
      setSyncing(true)
      try {
        // The store keys by ABS user id on THIS server, not the Clerk id.
        const me = await getMe(target)
        if (!me?.id) {
          const result: AvatarSyncResult = { ok: false, reason: 'no_abs_user' }
          setLastResult(result)
          return result
        }
        const result = await syncClerkAvatar(target, me.id, imageUrl)
        // Record the fingerprint whenever the server accepted the request path
        // (a skip because a manual upload wins is also "done" - but we only stamp
        // on a real store so a later upload-removal re-syncs).
        if (result.ok) {
          localStorage.setItem(fpKey(target.serverId), imageUrl)
          // Other users' views cache-bust on ?v=; nudge our own me query so the
          // account page reflects the new server-side photo if it reads it.
          queryClient.invalidateQueries({ queryKey: ['me', target.serverUrl] })
        }
        setLastResult(result)
        return result
      } catch {
        const result: AvatarSyncResult = { ok: false, reason: 'request_failed' }
        setLastResult(result)
        return result
      } finally {
        inFlight.current = false
        setSyncing(false)
      }
    },
    [isLoaded, user, target, queryClient],
  )

  // Silent auto-sync on load / when the photo or active server changes.
  useEffect(() => {
    void run(false)
  }, [run])

  const sync = useCallback(() => run(true), [run])
  return { sync, syncing, lastResult }
}
