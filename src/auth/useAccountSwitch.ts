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
import { useSignIn, useClerk } from '@clerk/clerk-react'
import {
  requestSwitchTicket,
  forgetRemembered,
  ApiError,
} from '@/api/controlPlane'
import { useRememberedAccounts, type RememberedAccount } from '@/store/rememberedAccounts'

export type SwitchOutcome =
  | { ok: true }
  | { ok: false; reason: 'pin' | 'locked_out' | 'gone' | 'error'; message?: string; attemptsLeft?: number }

export function useAccountSwitch() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const { signOut, redirectToSignIn } = useClerk()
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
   * explicitly wants to re-authenticate.
   */
  const loginWithPassword = useCallback(async () => {
    await signOut()
    redirectToSignIn()
  }, [signOut, redirectToSignIn])

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

  return { switchTo, loginWithPassword, forgetAccount, ready: isLoaded }
}
