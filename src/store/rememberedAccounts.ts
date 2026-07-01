/**
 * Accounts remembered on THIS device, for the account switcher.
 *
 * Clerk multi-session is paid, so we can't keep several live sessions in the
 * browser. Instead each remembered account is an opaque `handle` (minted by the
 * control plane) plus display snapshots. Swapping presents the handle to the CP,
 * which mints a single-use Clerk sign-in ticket for that account.
 *
 * IMPORTANT: this store holds NO credentials - only opaque handles and cosmetic
 * label/avatar. A stolen handle can, at most, request a switch ticket from an
 * already-authenticated browser, and handles are server-side revocable + expire.
 * This keeps the app's "no tokens in localStorage" boundary intact.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface RememberedAccount {
  /** Opaque control-plane handle. The only non-cosmetic field. */
  handle: string
  /** Clerk user id, so we can dedupe and hide the currently-active user. */
  userId: string
  label: string
  imageUrl?: string
  hasPin: boolean
}

interface RememberedState {
  accounts: RememberedAccount[]
  /** Add or replace (by userId) a remembered account. */
  remember: (a: RememberedAccount) => void
  /** Drop one by handle (forgotten / revoked / locked out). */
  forget: (handle: string) => void
  /** Replace the roster with a reconciled list (after a snapshot refresh). */
  setAll: (accounts: RememberedAccount[]) => void
}

export const useRememberedAccounts = create<RememberedState>()(
  persist(
    (set) => ({
      accounts: [],
      remember: (a) =>
        set((s) => ({
          accounts: [...s.accounts.filter((x) => x.userId !== a.userId), a],
        })),
      forget: (handle) =>
        set((s) => ({ accounts: s.accounts.filter((x) => x.handle !== handle) })),
      setAll: (accounts) => set({ accounts }),
    }),
    { name: 'hearthshelf:remembered' }
  )
)
