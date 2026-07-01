/**
 * Account-switch orchestration for the device switcher.
 *
 * Since Clerk multi-session is paid, a "swap" is really: mint a single-use Clerk
 * sign-in ticket for the target account (via the control plane), redeem it with
 * the ticket strategy, and make that the active session (replacing the current
 * one - we only ever hold one). A PIN-protected account first passes the PIN
 * gate. Every path has a "log in with password" escape hatch that drops the
 * session and forces a fresh Clerk sign-in.
 */
import { useCallback } from 'react'
import { useSignIn, useClerk, useUser } from '@clerk/clerk-react'
import {
  requestSwitchTicket,
  forgetRemembered,
  rememberCurrentUser,
  ApiError,
} from '@/api/controlPlane'
import { useRememberedAccounts, type RememberedAccount } from '@/store/rememberedAccounts'

export type SwitchOutcome =
  | { ok: true }
  | { ok: false; reason: 'pin' | 'locked_out' | 'gone' | 'error'; message?: string; attemptsLeft?: number }

export function useAccountSwitch() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const { signOut, redirectToSignIn } = useClerk()
  const { user } = useUser()
  const accounts = useRememberedAccounts((s) => s.accounts)
  const remember = useRememberedAccounts((s) => s.remember)
  const forget = useRememberedAccounts((s) => s.forget)

  /**
   * Swap into a remembered account. If it has a PIN, pass the entered `pin`.
   * Returns a discriminated outcome so the UI can react (re-prompt on 'pin',
   * fall back to password on 'locked_out'/'gone'/'error').
   */
  const switchTo = useCallback(
    async (account: RememberedAccount, pin?: string): Promise<SwitchOutcome> => {
      if (!isLoaded || !signIn || !setActive) return { ok: false, reason: 'error' }
      let ticket: string
      try {
        const res = await requestSwitchTicket(account.handle, pin)
        ticket = res.ticket
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 403) return { ok: false, reason: 'pin', message: e.message }
          if (e.status === 410) {
            // Locked out: the handle is gone server-side. Prune locally too.
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

      try {
        const attempt = await signIn.create({ strategy: 'ticket', ticket })
        if (attempt.status === 'complete' && attempt.createdSessionId) {
          await setActive({ session: attempt.createdSessionId })
          return { ok: true }
        }
        // Any non-complete status (e.g. MFA required) can't be finished silently.
        return { ok: false, reason: 'error', message: `unexpected status: ${attempt.status}` }
      } catch (e) {
        return { ok: false, reason: 'error', message: (e as Error).message }
      }
    },
    [isLoaded, signIn, setActive, forget]
  )

  /**
   * The "Log in with password" escape hatch. Drops the current session and sends
   * the user to a fresh Clerk sign-in (whatever method they use). This is the
   * always-available fallback when a swap fails, a PIN is forgotten, or the user
   * explicitly wants to re-authenticate. Does NOT remember the current user
   * first - that's the point of the distinct "sign in another user" action below.
   */
  const loginWithPassword = useCallback(async () => {
    await signOut()
    redirectToSignIn()
  }, [signOut, redirectToSignIn])

  /**
   * "Sign in another user": remembers the CURRENT account on this device (if it
   * isn't already), then signs out and sends the browser to a fresh sign-in.
   *
   * Clerk's client-side `openSignIn()` only makes sense for a signed-OUT user on
   * the free tier - with no multi-session, opening it while already signed in
   * has nothing to attach a second identity to, so it silently no-ops. The only
   * way to actually add a second user is to sign out and sign back in as them -
   * remembering the current user FIRST is what makes that safe: they land back
   * in the roster and can tap straight back in afterward instead of having to
   * retype their password. This is what distinguishes the action from the plain
   * "Log in with password" escape hatch.
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
        // sign in as someone else - they'll just need their password to come
        // back, same as before this feature existed.
      }
    }
    await loginWithPassword()
  }, [user, accounts, remember, loginWithPassword])

  /** Forget a remembered account (server revoke + local prune). */
  const forgetAccount = useCallback(
    async (account: RememberedAccount) => {
      try {
        await forgetRemembered(account.handle)
      } finally {
        forget(account.handle)
      }
    },
    [forget]
  )

  return { switchTo, loginWithPassword, signInAnotherUser, forgetAccount, ready: isLoaded }
}
