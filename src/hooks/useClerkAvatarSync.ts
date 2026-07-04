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
import { syncClerkAvatar } from '@/api/avatars'

// Fingerprint of the last Clerk imageUrl we synced to a given server, so an
// unchanged photo doesn't re-upload on every load. Keyed by server id.
function fpKey(serverId: string): string {
  return `hs:clerk-avatar-fp:${serverId}`
}

export function useClerkAvatarSync(): { sync: () => Promise<boolean>; syncing: boolean } {
  const { user, isLoaded } = useUser()
  const { target } = useActiveServer()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  // Guards against overlapping runs (the auto-effect + a button tap).
  const inFlight = useRef(false)

  const run = useCallback(
    async (force: boolean): Promise<boolean> => {
      if (inFlight.current) return false
      if (!isLoaded || !user || !target) return false
      const imageUrl = user.imageUrl
      if (!imageUrl) return false
      if (!force && localStorage.getItem(fpKey(target.serverId)) === imageUrl) return false

      inFlight.current = true
      setSyncing(true)
      try {
        // The store keys by ABS user id on THIS server, not the Clerk id.
        const me = await getMe(target)
        if (!me?.id) return false
        const ok = await syncClerkAvatar(target, me.id, imageUrl)
        // Record the fingerprint whenever the server accepted the request path
        // (ok true = stored; a skip because a manual upload wins is also "done" -
        // but we only stamp on a real store so a later upload-removal re-syncs).
        if (ok) {
          localStorage.setItem(fpKey(target.serverId), imageUrl)
          // Other users' views cache-bust on ?v=; nudge our own me query so the
          // account page reflects the new server-side photo if it reads it.
          queryClient.invalidateQueries({ queryKey: ['me', target.serverUrl] })
        }
        return ok
      } catch {
        return false
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
  return { sync, syncing }
}
