import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/auth/client'
import { useAuth } from '@/auth/useAuth'
import { notify } from '@/lib/notify'

/**
 * Account identity management: username, passkeys, and two-factor.
 *
 * Replaces the previous provider's drop-in profile widget. It is deliberately
 * narrower than that widget was, and the omissions are the point:
 *
 *  - No password section. Sign-in is passkeys, social, magic links and codes;
 *    the two migrated accounts that had a password use a magic link instead.
 *  - No email change. The email is how a self-hosted server matches a user to
 *    their AudiobookShelf account, so changing it is not a profile edit - it
 *    would silently orphan every linked server.
 *  - No connected-accounts list. Social identities are how people sign in, and
 *    unlinking the only one would lock them out.
 *
 * Passkeys ARE managed here, because that is the method we want people using
 * and it is useless if they cannot add one from the account page.
 */
interface Passkey {
  id: string
  name?: string | null
  createdAt?: string | Date | null
}

export function ProfilePanel() {
  const { user } = useAuth()
  const [username, setUsername] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)

  useEffect(() => {
    setUsername(user?.username ?? '')
  }, [user?.username])

  const loadPasskeys = useCallback(async () => {
    const res = await authClient.passkey.listUserPasskeys()
    setPasskeys((res?.data as Passkey[] | undefined) ?? [])
  }, [])

  useEffect(() => {
    void loadPasskeys().catch(() => setPasskeys([]))
  }, [loadPasskeys])

  async function saveUsername() {
    const next = username.trim()
    if (!next || next === user?.username) return
    setSavingName(true)
    try {
      const res = await authClient.updateUser({ username: next })
      if (res?.error) {
        notify.error(res.error.message || 'That username is taken')
        return
      }
      notify.success('Username updated')
    } finally {
      setSavingName(false)
    }
  }

  async function addPasskey() {
    setAdding(true)
    try {
      const res = await authClient.passkey.addPasskey()
      if (res?.error) {
        notify.error(res.error.message || 'Could not add a passkey on this device')
        return
      }
      notify.success('Passkey added')
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
      const res = await authClient.twoFactor.getTotpUri({ password: '' })
      if (res?.error) {
        notify.error(res.error.message || 'Could not start two-factor setup')
        return
      }
      setTotpUri((res?.data as { totpURI?: string } | undefined)?.totpURI ?? null)
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
      setTotpCode('')
      notify.success('Two-factor is on')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  if (!user) return null

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-border bg-card p-6">
        <p className="t-eyebrow">Profile</p>
        <p className="t-muted mt-2 text-[13px]">
          {user.email} - this is how your servers recognise you, so it cannot be changed here.
        </p>

        <label className="mt-4 block text-sm" htmlFor="account-username">
          Username
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="account-username"
            className="input flex-1"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <button
            className="btn-secondary"
            onClick={saveUsername}
            disabled={savingName || !username.trim() || username.trim() === user.username}
          >
            Save
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <p className="t-eyebrow">Passkeys</p>
        <p className="t-muted mt-2 text-[13px]">
          Sign in with your face, fingerprint, or screen lock - no password, nothing to remember.
        </p>

        {passkeys === null ? (
          <p className="t-muted mt-4 text-[13px]">Loading...</p>
        ) : passkeys.length === 0 ? (
          <p className="t-muted mt-4 text-[13px]">No passkeys yet on any device.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {passkeys.map((pk) => (
              <li key={pk.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{pk.name || 'Passkey'}</span>
                <button className="btn-link" onClick={() => void removePasskey(pk.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn-primary mt-4" onClick={addPasskey} disabled={adding}>
          Add a passkey
        </button>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <p className="t-eyebrow">Two-factor</p>
        <p className="t-muted mt-2 text-[13px]">
          Ask for a code from your authenticator app as well as your usual sign-in.
        </p>

        {totpUri ? (
          <>
            <p className="t-muted mt-4 text-[13px]">
              Scan this in your authenticator app, then enter the code it shows.
            </p>
            <code className="mt-2 block break-all rounded-md bg-muted p-3 text-[11px]">
              {totpUri}
            </code>
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
                Confirm
              </button>
            </div>
          </>
        ) : (
          <button className="btn-secondary mt-4" onClick={startTwoFactor} disabled={twoFactorBusy}>
            Set up two-factor
          </button>
        )}
      </section>
    </div>
  )
}
