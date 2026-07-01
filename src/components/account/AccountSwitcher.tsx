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
import { rememberCurrentUser } from '@/api/controlPlane'

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
  const [busy, setBusy] = useState(false)

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

  return (
    <>
      {others.length > 0 && (
        <>
          <div className="switch-label">Switch account</div>
          {others.map((a) => (
            <button key={a.handle} onClick={() => onTapAccount(a)} disabled={busy}>
              <Avatar name={a.label} imageUrl={a.imageUrl} size={22} />
              <span className="switch-name">{a.label}</span>
              {a.hasPin && <Icon name="lock" className="switch-lock" />}
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
    </>
  )
}
