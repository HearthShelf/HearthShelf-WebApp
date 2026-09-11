import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/auth/client'
import { useAuth } from '@/auth/useAuth'
import { notify } from '@/lib/notify'
import { AppleIcon, DiscordIcon, GoogleIcon } from '@/components/auth/ProviderIcons'
import { Icon } from '@/components/common/Icon'
import { AccountInfoTip } from '@/components/settings/AccountInfoTip'

/**
 * Every way this account can sign in, in one place: linked social accounts and
 * a password.
 *
 * WHY LINKING MATTERS HERE. Sign-in methods are the only route back into an
 * account, so a single one is a single point of failure - lose access to that
 * Google account and the HearthShelf account goes with it. Linking a second
 * provider is the fix, and it cannot be done during sign-in (you are not
 * authenticated yet to prove the two identities are the same person), so it has
 * to live on this page.
 *
 * THE LAST-METHOD GUARD IS THE SERVER'S. The service refuses to unlink an
 * account's only remaining credential (FAILED_TO_UNLINK_LAST_ACCOUNT), so a
 * user cannot lock themselves out even if this UI is wrong. We mirror that rule
 * by disabling the button, but the server is the authority - the UI is a
 * courtesy, not the enforcement.
 */
const PROVIDERS = [
  { id: 'google', label: 'Google', Icon: GoogleIcon },
  { id: 'apple', label: 'Apple', Icon: AppleIcon },
  { id: 'discord', label: 'Discord', Icon: DiscordIcon },
] as const

/** `providerId` is the social provider, or 'credential' for a password. */
interface LinkedAccount {
  id: string
  providerId: string
  accountId?: string
  createdAt?: string | Date | null
}

export function SignInMethods({
  onPasswordStatusChange,
}: {
  onPasswordStatusChange?: (hasPassword: boolean) => void
}) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Password fields. Setting one when none exists and changing an existing one
  // are the same endpoint; `currentPassword` is what differs.
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const load = useCallback(async () => {
    const res = await authClient.listAccounts()
    setAccounts((res?.data as LinkedAccount[] | undefined) ?? [])
  }, [])

  useEffect(() => {
    void load().catch(() => setAccounts([]))
  }, [load])

  const linked = accounts ?? []
  const hasPassword = linked.some((a) => a.providerId === 'credential')
  const social = linked.filter((a) => a.providerId !== 'credential')
  // What the server counts when it refuses the last unlink.
  const totalMethods = linked.length

  useEffect(() => {
    if (accounts !== null) onPasswordStatusChange?.(hasPassword)
  }, [accounts, hasPassword, onPasswordStatusChange])

  async function link(provider: string) {
    setBusy(provider)
    try {
      // Sends the browser to the provider and back; nothing after this runs on
      // a success, so there is no "linked!" toast here - the reloaded page
      // shows the new entry instead.
      const res = await authClient.linkSocial({
        provider,
        callbackURL: `${window.location.origin}/account/account`,
      })
      if (res?.error) notify.error(res.error.message || `Could not connect ${provider}`)
    } catch (e) {
      notify.error((e as Error)?.message || `Could not connect ${provider}`)
    } finally {
      setBusy(null)
    }
  }

  async function unlink(account: LinkedAccount) {
    setBusy(account.id)
    try {
      const res = await authClient.unlinkAccount({ accountId: account.id })
      if (res?.error) {
        notify.error(res.error.message || 'Could not disconnect that account')
        return
      }
      notify.success('Disconnected')
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function savePassword() {
    if (!newPassword) return
    setSavingPassword(true)
    try {
      const res = await authClient.changePassword({
        newPassword,
        currentPassword,
        // Other devices keep their sessions: changing a password here is
        // routine account hygiene, not a "someone got in" response. A user who
        // wants everything signed out can do that explicitly.
        revokeOtherSessions: false,
      })
      if (res?.error) {
        notify.error(res.error.message || 'Could not change your password')
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      notify.success(hasPassword ? 'Password changed' : 'Password set')
      await load()
    } finally {
      setSavingPassword(false)
    }
  }

  if (!user) return null

  return (
    <section className="account-security-card sign-in-methods">
      <div className="account-card-heading">
        <span className="account-card-icon" aria-hidden="true">
          <Icon name="login" />
        </span>
        <div className="account-card-title">
          <h3>Sign-in methods</h3>
          <AccountInfoTip text="Add a backup way to sign in so you can always get back to your HearthShelf account." />
        </div>
      </div>

      {accounts === null ? (
        <div className="auth-methods-loading" aria-label="Loading sign-in methods">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <ul className="auth-method-list">
          {PROVIDERS.map((p) => {
            const existing = social.find((a) => a.providerId === p.id)
            const ProviderIcon = p.Icon
            // Never offer to remove the only way in - the server would refuse
            // anyway, and a button that always errors is worse than no button.
            const isLast = totalMethods <= 1
            return (
              <li key={p.id} className="auth-method-row">
                <span className={`auth-provider-mark auth-provider-${p.id}`} aria-hidden="true">
                  <ProviderIcon />
                </span>
                <span className="auth-method-copy">
                  <strong>{p.label}</strong>
                  <span
                    className={existing ? 'auth-method-status connected' : 'auth-method-status'}
                  >
                    <i /> {existing ? 'Connected' : 'Not connected'}
                  </span>
                </span>
                {existing ? (
                  <button
                    className="btn-sm btn-ghost"
                    onClick={() => void unlink(existing)}
                    disabled={busy === existing.id || isLast}
                    title={isLast ? 'This is your only way to sign in' : undefined}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="btn-sm btn-ghost"
                    onClick={() => void link(p.id)}
                    disabled={busy === p.id}
                  >
                    Connect
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="auth-password-panel">
        <span className="account-card-icon auth-password-icon" aria-hidden="true">
          <Icon name="password" />
        </span>
        <div className="auth-password-content">
          <div className="account-card-title">
            <h4>{hasPassword ? 'Password' : 'Add a password'}</h4>
            <AccountInfoTip
              text={
                hasPassword
                  ? 'Change it here whenever you need to.'
                  : 'Optional if you prefer passkeys or email codes.'
              }
            />
          </div>
          <div className="auth-password-fields">
            {hasPassword ? (
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            ) : null}
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={hasPassword ? 'New password' : 'Password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              className="btn-secondary self-start"
              onClick={savePassword}
              disabled={savingPassword || !newPassword || (hasPassword && !currentPassword)}
            >
              {hasPassword ? 'Change password' : 'Set password'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
