import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/auth/client'
import { useAuth } from '@/auth/useAuth'
import { notify } from '@/lib/notify'
import { SignInMethods } from '@/components/auth/SignInMethods'
import QRCode from 'qrcode'
import { AccountInfoTip } from '@/components/settings/AccountInfoTip'

/**
 * Account security management: passkeys and two-factor.
 *
 * Replaces the previous provider's drop-in profile widget. It is deliberately
 * narrower than that widget was, and the omissions are the point:
 *
 *  - No email change. The email is how a self-hosted server matches a user to
 *    their AudiobookShelf account, so changing it is not a profile edit - it
 *    would silently orphan every linked server.
 *
 * Passkeys and linked sign-in methods ARE managed here: they are the only route
 * back into an account, so a user who cannot manage them from this page has no
 * way to recover from losing one.
 */
interface Passkey {
  id: string
  name?: string | null
  createdAt?: string | Date | null
}

export function ProfilePanel() {
  const { user } = useAuth()
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [namingPasskey, setNamingPasskey] = useState(false)
  const [passkeyName, setPasskeyName] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [totpQr, setTotpQr] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [twoFactorPassword, setTwoFactorPassword] = useState('')
  const [twoFactorMode, setTwoFactorMode] = useState<'enable' | 'disable' | null>(null)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)

  useEffect(() => {
    setTwoFactorEnabled(user?.twoFactorEnabled === true)
  }, [user?.twoFactorEnabled])

  const loadPasskeys = useCallback(async () => {
    const res = await authClient.passkey.listUserPasskeys()
    setPasskeys((res?.data as Passkey[] | undefined) ?? [])
  }, [])

  useEffect(() => {
    void loadPasskeys().catch(() => setPasskeys([]))
  }, [loadPasskeys])

  async function addPasskey() {
    const name = passkeyName.trim()
    if (!name) return
    setAdding(true)
    try {
      const res = await authClient.passkey.addPasskey({ name })
      if (res?.error) {
        notify.error(res.error.message || 'Could not add a passkey on this device')
        return
      }
      notify.success('Passkey added')
      setNamingPasskey(false)
      setPasskeyName('')
      await loadPasskeys()
    } catch {
      // A cancelled browser prompt rejects; that is a choice, not a failure.
    } finally {
      setAdding(false)
    }
  }

  async function removePasskey(id: string) {
    const res = await authClient.passkey.deletePasskey({ id })
    if (res?.error) {
      notify.error(res.error.message || 'Could not remove that passkey')
      return
    }
    await loadPasskeys()
  }

  /**
   * Begin two-factor setup.
   *
   * Enabling returns the TOTP URI to scan; it is not active until a code from
   * the app is confirmed below, so a mis-scanned secret cannot lock anyone out.
   */
  async function startTwoFactor() {
    setTwoFactorBusy(true)
    try {
      const res = await authClient.twoFactor.enable({
        // With allowPasswordless enabled, Better Auth ignores this for an
        // account that has no credential and still verifies real passwords.
        password: hasPassword ? twoFactorPassword : '',
        method: 'totp',
        issuer: 'HearthShelf',
      })
      if (res?.error) {
        notify.error(
          res.error.message === 'Invalid password'
            ? hasPassword
              ? 'Enter your current password to continue'
              : 'Could not verify this passwordless account. Refresh and try again.'
            : res.error.message || 'Could not start two-factor setup',
        )
        return
      }
      const data = res?.data as { totpURI?: string; backupCodes?: string[] } | undefined
      const uri = data?.totpURI ?? null
      setTotpUri(uri)
      setBackupCodes(data?.backupCodes ?? [])
      if (uri) {
        setTotpQr(
          await QRCode.toDataURL(uri, {
            width: 200,
            margin: 1,
            color: { dark: '#1b1a18', light: '#fffaf6' },
          }),
        )
      }
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function confirmTwoFactor() {
    setTwoFactorBusy(true)
    try {
      const res = await authClient.twoFactor.verifyTotp({ code: totpCode.trim() })
      if (res?.error) {
        notify.error(res.error.message || 'That code did not match')
        return
      }
      setTotpUri(null)
      setTotpQr(null)
      setTotpCode('')
      setTwoFactorPassword('')
      setTwoFactorMode(null)
      setTwoFactorEnabled(true)
      notify.success('Two-factor is on')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function disableTwoFactor() {
    setTwoFactorBusy(true)
    try {
      const res = await authClient.twoFactor.disable({
        password: hasPassword ? twoFactorPassword : '',
      })
      if (res?.error) {
        notify.error(res.error.message || 'Could not turn off two-factor authentication')
        return
      }
      setTwoFactorEnabled(false)
      setTwoFactorMode(null)
      setTwoFactorPassword('')
      setBackupCodes([])
      notify.success('Two-factor is off')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  if (!user) return null

  return (
    <div className="flex flex-col gap-8">
      <SignInMethods onPasswordStatusChange={setHasPassword} />

      <section className="account-security-card">
        <div className="account-card-title">
          <h3>Passkeys</h3>
          <AccountInfoTip text="Sign in with your face, fingerprint, or screen lock. There is no password to remember." />
        </div>

        {passkeys === null ? (
          <p className="t-muted mt-4 text-[13px]">Loading...</p>
        ) : passkeys.length === 0 ? (
          <p className="t-muted mt-4 text-[13px]">No passkeys yet on any device.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {passkeys.map((pk) => (
              <li key={pk.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{pk.name || 'Passkey'}</span>
                <button
                  type="button"
                  className="btn-sm btn-ghost danger"
                  onClick={() => void removePasskey(pk.id)}
                  aria-label={`Remove ${pk.name || 'passkey'}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {namingPasskey ? (
          <div className="account-inline-setup">
            <label htmlFor="passkey-name">Name this passkey</label>
            <p className="t-muted">Use a name you will recognize later, like “Kitchen iPad.”</p>
            <div className="account-inline-field">
              <input
                id="passkey-name"
                className="input"
                placeholder="This device"
                value={passkeyName}
                onChange={(event) => setPasskeyName(event.target.value)}
                autoFocus
              />
              <button
                className="btn-primary"
                onClick={() => void addPasskey()}
                disabled={adding || !passkeyName.trim()}
              >
                {adding ? 'Adding…' : 'Create passkey'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setNamingPasskey(false)
                  setPasskeyName('')
                }}
                disabled={adding}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-primary mt-4" onClick={() => setNamingPasskey(true)}>
            Add a passkey
          </button>
        )}
      </section>

      <section className="account-security-card">
        <div className="account-card-title">
          <h3>Two-factor authentication</h3>
          <AccountInfoTip text="Ask for a code from your authenticator app as well as your usual sign-in." />
        </div>
        <div className="account-security-status">
          <span className={twoFactorEnabled ? 'connected' : ''}>
            {twoFactorEnabled ? 'On' : 'Off'}
          </span>
        </div>

        {totpUri ? (
          <div className="two-factor-setup">
            <h4>Scan with your authenticator app</h4>
            {totpQr && <img src={totpQr} alt="QR code for HearthShelf two-factor setup" />}
            <a href={totpUri}>Open in an authenticator app</a>
            <p className="t-muted">Then enter the six-digit code it shows.</p>
            <div className="mt-3 flex gap-2">
              <input
                className="input flex-1 tracking-[0.4em]"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
              <button className="btn-primary" onClick={confirmTwoFactor} disabled={twoFactorBusy}>
                {twoFactorBusy ? 'Checking…' : 'Turn on two-factor'}
              </button>
            </div>
          </div>
        ) : twoFactorMode && hasPassword ? (
          <div className="account-inline-setup">
            <label htmlFor="two-factor-password">Current password</label>
            <p className="t-muted">Enter your password to confirm this change.</p>
            <div className="account-inline-field">
              <input
                id="two-factor-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
              />
              <button
                className={twoFactorMode === 'disable' ? 'btn-danger' : 'btn-primary'}
                onClick={() =>
                  void (twoFactorMode === 'disable' ? disableTwoFactor() : startTwoFactor())
                }
                disabled={twoFactorBusy}
              >
                {twoFactorBusy ? 'Working…' : twoFactorMode === 'disable' ? 'Turn off' : 'Continue'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setTwoFactorMode(null)
                  setTwoFactorPassword('')
                }}
                disabled={twoFactorBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : backupCodes.length > 0 ? (
          <div className="two-factor-recovery">
            <h4>Save your recovery codes</h4>
            <p className="t-muted">Keep these somewhere safe. Each code can be used once.</p>
            <code>{backupCodes.join('\n')}</code>
            <button className="btn-secondary" onClick={() => setBackupCodes([])}>
              I saved them
            </button>
          </div>
        ) : (
          <button
            className="btn-secondary mt-4"
            onClick={() => {
              const mode = twoFactorEnabled ? 'disable' : 'enable'
              if (hasPassword) setTwoFactorMode(mode)
              else if (mode === 'disable') void disableTwoFactor()
              else void startTwoFactor()
            }}
            disabled={twoFactorBusy || hasPassword === null}
          >
            {hasPassword === null
              ? 'Checking account…'
              : twoFactorBusy
                ? 'Working…'
                : twoFactorEnabled
                  ? 'Turn off two-factor'
                  : 'Set up two-factor'}
          </button>
        )}
      </section>
    </div>
  )
}
