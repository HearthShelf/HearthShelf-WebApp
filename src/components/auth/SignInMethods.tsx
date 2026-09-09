import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/auth/client'
import { useAuth } from '@/auth/useAuth'
import { notify } from '@/lib/notify'

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
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'discord', label: 'Discord' },
] as const

/** `providerId` is the social provider, or 'credential' for a password. */
interface LinkedAccount {
  id: string
  providerId: string
  accountId?: string
  createdAt?: string | Date | null
}

export function SignInMethods() {
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

  async function link(provider: string) {
    setBusy(provider)
    try {
      // Sends the browser to the provider and back; nothing after this runs on
      // a success, so there is no "linked!" toast here - the reloaded page
      // shows the new entry instead.
      const res = await authClient.linkSocial({
        provider,
        callbackURL: `${window.location.origin}/account/profile`,
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
    <section className="rounded-xl border border-border bg-card p-6">
      <p className="t-eyebrow">Ways to sign in</p>
      <p className="t-muted mt-2 text-[13px]">
        Connect more than one, so losing access to any single account never locks you out of
        HearthShelf.
      </p>

      {accounts === null ? (
        <p className="t-muted mt-4 text-[13px]">Loading...</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {PROVIDERS.map((p) => {
            const existing = social.find((a) => a.providerId === p.id)
            // Never offer to remove the only way in - the server would refuse
            // anyway, and a button that always errors is worse than no button.
            const isLast = totalMethods <= 1
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {p.label}
                  {existing ? <span className="t-muted"> - connected</span> : null}
                </span>
                {existing ? (
                  <button
                    className="btn-link"
                    onClick={() => void unlink(existing)}
                    disabled={busy === existing.id || isLast}
                    title={isLast ? 'This is your only way to sign in' : undefined}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="btn-link"
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

      <div className="mt-6 border-t border-border pt-4">
        <p className="text-sm">{hasPassword ? 'Change your password' : 'Add a password'}</p>
        <p className="t-muted mt-1 text-[13px]">
          {hasPassword
            ? 'You can also sign in with a passkey, a link, or a code.'
            : 'Optional - passkeys and email links work without one.'}
        </p>
        <div className="mt-3 flex flex-col gap-2">
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
    </section>
  )
}
