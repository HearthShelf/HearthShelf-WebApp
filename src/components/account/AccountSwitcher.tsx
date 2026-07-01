/**
 * The account-switcher body shared by the desktop sidebar menu and the mobile
 * drawer. Renders the remembered-accounts roster (tap to swap), plus the
 * "Sign in another user", "Log in with password", and per-account actions. Drives
 * the PIN pad for PIN-protected swaps.
 *
 * Presentational shell only: the caller passes the wrapper (the `.user-menu` in
 * the sidebar, a drawer section on mobile), and we fill it with rows.
 */
import { useState, useCallback } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { PinEntryOverlay } from '@/components/account/PinEntryOverlay'
import { useRememberedAccounts, type RememberedAccount } from '@/store/rememberedAccounts'
import { useAccountSwitch } from '@/auth/useAccountSwitch'
import { rememberCurrentUser, forgetRemembered, ApiError } from '@/api/controlPlane'

interface Props {
  /** Called after any navigation/action so the caller can close its menu. */
  onDone?: () => void
  /** Navigate helper (react-router) for the settings/admin rows. */
  onNavigate: (to: string) => void
  /** Whether to show the "Platform admin" row. */
  showAdmin: boolean
}

export function AccountSwitcher({ onDone, onNavigate, showAdmin }: Props) {
  const { user } = useUser()
  const { openSignIn } = useClerk()
  const accounts = useRememberedAccounts((s) => s.accounts)
  const remember = useRememberedAccounts((s) => s.remember)
  const { switchTo, loginWithPassword, ready } = useAccountSwitch()

  // The account whose PIN we're currently collecting (null = pad closed).
  const [pinFor, setPinFor] = useState<RememberedAccount | null>(null)
  // The account we're forgetting - shows the pad in "forget" mode instead of
  // "switch" mode (different title, offers the "forgot PIN?" escape hatch).
  const [forgetFor, setForgetFor] = useState<RememberedAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const forget = useRememberedAccounts((s) => s.forget)

  // Don't offer to swap into whoever is already active.
  const others = accounts.filter((a) => a.userId !== user?.id)
  const currentRemembered = accounts.some((a) => a.userId === user?.id)

  const name = user?.username || user?.firstName || user?.primaryEmailAddress?.emailAddress || '?'

  const rememberCurrent = useCallback(async () => {
    if (!user) return
    const res = await rememberCurrentUser({ label: name, imageUrl: user.imageUrl })
    remember({
      handle: res.handle,
      userId: user.id,
      label: res.label,
      imageUrl: user.imageUrl,
      hasPin: res.has_pin,
    })
  }, [user, name, remember])

  const doSwitch = useCallback(
    async (account: RememberedAccount, pin?: string) => {
      setBusy(true)
      try {
        const res = await switchTo(account, pin)
        if (res.ok) {
          // Session replaced; a full reload lands cleanly as the new user.
          window.location.assign('/')
          return true
        }
        if (res.reason === 'pin') {
          setPinFor(account)
          return false
        }
        // locked_out / gone / error: fall back to a real sign-in.
        await loginWithPassword()
        return false
      } finally {
        setBusy(false)
      }
    },
    [switchTo, loginWithPassword]
  )

  const onTapAccount = useCallback(
    (account: RememberedAccount) => {
      if (busy || !ready) return
      if (account.hasPin) setPinFor(account)
      else void doSwitch(account)
    },
    [busy, ready, doSwitch]
  )

  /** "Forget this account" tap: PIN-less accounts confirm once and are done;
   *  PIN-protected accounts open the pad in forget mode. */
  const onForgetTap = useCallback(
    (account: RememberedAccount, e: React.MouseEvent) => {
      e.stopPropagation()
      if (account.hasPin) {
        setForgetFor(account)
        return
      }
      if (!window.confirm(`Forget ${account.label} on this device?`)) return
      void forgetRemembered(account.handle).finally(() => forget(account.handle))
    },
    [forget]
  )

  /** Verify the PIN for a forget attempt (does NOT switch accounts). */
  const verifyForgetPin = useCallback(
    async (account: RememberedAccount, pin: string): Promise<boolean> => {
      try {
        await forgetRemembered(account.handle, { pin })
        forget(account.handle)
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) return false
        // 410 (locked out) or anything else: the CP already dropped the handle
        // (or it's already gone) - prune locally and treat as "succeeded".
        forget(account.handle)
        return true
      }
    },
    [forget]
  )

  /** "Forgot PIN?" inside the forget pad: confirm, then force-remove without a
   *  PIN. Only removes the local handle - never touches the account's session
   *  anywhere else. */
  const forgotPin = useCallback(
    async (account: RememberedAccount) => {
      if (
        !window.confirm(
          `This will remove ${account.label} from this device. You'll need to sign in again to use it here.`
        )
      )
        return
      try {
        await forgetRemembered(account.handle, { confirmForgot: true })
      } finally {
        forget(account.handle)
        setForgetFor(null)
      }
    },
    [forget]
  )

  return (
    <>
      {others.length > 0 && (
        <>
          <div className="switch-label">Switch account</div>
          {others.map((a) => (
            <button key={a.handle} className="switch-row" onClick={() => onTapAccount(a)} disabled={busy}>
              <Avatar name={a.label} imageUrl={a.imageUrl} size={22} />
              <span className="switch-name">{a.label}</span>
              {a.hasPin && <Icon name="lock" className="switch-lock" />}
              <span
                className="switch-forget"
                role="button"
                aria-label={`Forget ${a.label} on this device`}
                onClick={(e) => onForgetTap(a, e)}
              >
                <Icon name="close" />
              </span>
            </button>
          ))}
          <div className="sep" />
        </>
      )}

      {!currentRemembered && (
        <button onClick={() => { onDone?.(); void rememberCurrent() }}>
          <Icon name="bookmark_add" /> Remember this account
        </button>
      )}
      <button
        onClick={() => {
          onDone?.()
          openSignIn()
        }}
      >
        <Icon name="person_add" /> Sign in another user
      </button>
      <button
        onClick={() => {
          onDone?.()
          void loginWithPassword()
        }}
      >
        <Icon name="password" /> Log in with password
      </button>

      <div className="sep" />
      <button onClick={() => { onDone?.(); onNavigate('/account') }}>
        <Icon name="person" /> Account settings
      </button>
      {showAdmin && (
        <button onClick={() => { onDone?.(); onNavigate('/admin') }}>
          <Icon name="manage_accounts" /> Platform admin
        </button>
      )}
      <div className="sep" />
      <button className="danger" onClick={() => { onDone?.(); void loginWithPassword() }}>
        <Icon name="logout" /> Log out
      </button>

      {pinFor && (
        <PinEntryOverlay
          name={pinFor.label}
          imageUrl={pinFor.imageUrl}
          // The CP is the real PIN check; this client verify just forwards the
          // entered PIN into the swap and reports whether it was accepted.
          verify={async (pin) => {
            const ok = await doSwitch(pinFor, pin)
            return ok
          }}
          onSuccess={() => setPinFor(null)}
          onCancel={() => setPinFor(null)}
        />
      )}

      {forgetFor && (
        <PinEntryOverlay
          name={forgetFor.label}
          imageUrl={forgetFor.imageUrl}
          title={`Enter ${forgetFor.label}'s PIN to forget this account`}
          verify={(pin) => verifyForgetPin(forgetFor, pin)}
          onSuccess={() => setForgetFor(null)}
          onCancel={() => setForgetFor(null)}
          footer={
            <button type="button" onClick={() => void forgotPin(forgetFor)}>
              Forgot PIN?
            </button>
          }
        />
      )}
    </>
  )
}
