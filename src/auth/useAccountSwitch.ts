/**
 * Account-switch orchestration for the device switcher.
 *
 * The browser holds SEVERAL signed-in sessions at once (the multi-session
 * plugin, see ./client.ts), so a swap is a local `setActive` - no round trip,
 * no ticket. That replaces the previous shape, which existed only because the
 * old provider charged for multi-session: mint a single-use sign-in ticket for
 * the target account server-side, redeem it, and replace the one session we
 * were allowed to hold.
 *
 * ONE DELIBERATE WEAKENING. A PIN on a remembered account used to be enforced
 * by the SERVER, because minting that ticket was a call the server could refuse.
 * Now the sessions are already in the browser, so the PIN is a local gate: it
 * still stops a family member tapping into the wrong account, but it is not a
 * defence against someone holding the device with a debugger open. The PIN is
 * still verified against the control plane so a wrong one fails honestly and
 * lockouts still work - what changed is that passing it is no longer what
 * *produces* the session.
 *
 * Every path keeps the "log in with password" escape hatch that drops the
 * session and forces a fresh sign-in.
 */
import { useCallback } from 'react'
import { authClient } from './client'
import { useAuth } from './useAuth'
import {
  requestSwitchTicket,
  forgetRemembered,
  rememberCurrentUser,
  ApiError,
} from '@/api/controlPlane'
import { useRememberedAccounts, type RememberedAccount } from '@/store/rememberedAccounts'

export type SwitchOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'pin' | 'locked_out' | 'gone' | 'error' | 'needs_sign_in'
      message?: string
      attemptsLeft?: number
    }

export function useAccountSwitch() {
  const { user, isLoaded, signOut } = useAuth()
  const accounts = useRememberedAccounts((s) => s.accounts)
  const remember = useRememberedAccounts((s) => s.remember)
  const forget = useRememberedAccounts((s) => s.forget)

  /**
   * Swap into a remembered account. If it has a PIN, pass the entered `pin`.
   *
   * Returns a discriminated outcome so the UI can react: re-prompt on 'pin',
   * fall back to a password sign-in on 'locked_out' / 'gone' / 'error', and on
   * 'needs_sign_in' send the user through a normal sign-in - that last one
   * means the account is remembered on this device but has no live session
   * here (a new browser, or one that was signed out), which the ticket flow
   * used to paper over by minting a session on demand.
   */
  const switchTo = useCallback(
    async (account: RememberedAccount, pin?: string): Promise<SwitchOutcome> => {
      if (!isLoaded) return { ok: false, reason: 'error' }

      // Still ask the control plane first when a PIN is set: it owns the
      // attempt counter and the lockout, so a wrong PIN must fail there rather
      // than in a local comparison we could not rate-limit.
      if (account.hasPin) {
        try {
          await requestSwitchTicket(account.handle, pin)
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 403) return { ok: false, reason: 'pin', message: e.message }
            if (e.status === 410) {
              forget(account.handle)
              return { ok: false, reason: 'locked_out' }
            }
            if (e.status === 404) {
              forget(account.handle)
              return { ok: false, reason: 'gone' }
            }
          }
          return { ok: false, reason: 'error', message: (e as Error).message }
        }
      }

      try {
        const listed = await authClient.multiSession.listDeviceSessions()
        const sessions = (listed?.data ?? []) as {
          session: { token: string }
          user: { id: string }
        }[]
        const match = sessions.find((s) => s.user?.id === account.userId)
        if (!match) return { ok: false, reason: 'needs_sign_in' }

        const res = await authClient.multiSession.setActive({ sessionToken: match.session.token })
        if (res?.error) return { ok: false, reason: 'error', message: res.error.message }
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: 'error', message: (e as Error).message }
      }
    },
    [isLoaded, forget],
  )

  /**
   * The "log in with password" escape hatch. Drops the current session and
   * sends the user to a fresh sign-in (whatever method they use). The
   * always-available fallback when a swap fails, a PIN is forgotten, or the
   * user explicitly wants to re-authenticate. Does NOT remember the current
   * user first - that is the point of the distinct action below.
   */
  const loginWithPassword = useCallback(async () => {
    await signOut({ redirectUrl: '/sign-in' })
  }, [signOut])

  /**
   * "Sign in another user": remembers the CURRENT account on this device (if it
   * isn't already), then sends the browser to a fresh sign-in.
   *
   * Unlike before, this does NOT sign the current user out: multi-session means
   * the new sign-in ADDS a session rather than replacing one, so both accounts
   * end up live and switching between them afterwards is instant. Remembering
   * the current user first keeps them in the roster with their label and photo.
   */
  const signInAnotherUser = useCallback(async () => {
    if (user && !accounts.some((a) => a.userId === user.id)) {
      const name = user.username || user.firstName || user.primaryEmailAddress?.emailAddress || '?'
      try {
        const res = await rememberCurrentUser({ label: name, imageUrl: user.imageUrl ?? undefined })
        remember({
          handle: res.handle,
          userId: user.id,
          label: res.label,
          imageUrl: user.imageUrl ?? undefined,
          hasPin: res.has_pin,
        })
      } catch {
        // Best-effort: if remembering fails (offline, CP down), still let them
        // sign in as someone else - they just will not have a roster entry to
        // tap back into.
      }
    }
    window.location.href = '/sign-in'
  }, [user, accounts, remember])

  /** Forget a remembered account (server revoke + local prune + drop its session). */
  const forgetAccount = useCallback(
    async (account: RememberedAccount) => {
      try {
        await forgetRemembered(account.handle)
      } finally {
        forget(account.handle)
        // Also drop any live session for that account on this device, or the
        // account would keep appearing in the switcher's own session list after
        // the user asked to forget it.
        try {
          const listed = await authClient.multiSession.listDeviceSessions()
          const sessions = (listed?.data ?? []) as {
            session: { token: string }
            user: { id: string }
          }[]
          const match = sessions.find((s) => s.user?.id === account.userId)
          if (match) await authClient.multiSession.revoke({ sessionToken: match.session.token })
        } catch {
          // Best-effort - the local roster entry is already gone.
        }
      }
    },
    [forget],
  )

  return { switchTo, loginWithPassword, signInAnotherUser, forgetAccount, ready: isLoaded }
}
