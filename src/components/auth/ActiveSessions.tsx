import { useCallback, useEffect, useState } from 'react'
import { authClient, useSession } from '@/auth/client'
import { notify } from '@/lib/notify'
import { Icon } from '@/components/common/Icon'
import { AccountInfoTip } from '@/components/settings/AccountInfoTip'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

/**
 * Every browser and device currently signed in to this account, with a way to
 * sign any of them out.
 *
 * WHY THIS EXISTS. The `passwordChanged` and `newSignIn` emails both tell the
 * reader to "review your account and sign out other sessions" and link here. For
 * a while that link landed on an account page with no session list at all, so the
 * one action the email asked for was impossible - the security advice was a dead
 * end. Better Auth already stores `ipAddress` and `userAgent` per session and
 * exposes list/revoke endpoints; only this UI was missing.
 *
 * MULTI-SESSION IS WHY THE "THIS DEVICE" GUARD MATTERS. The account switcher
 * keeps several accounts signed in at once in the same browser, so the session
 * list for THIS account can legitimately include the one rendering this page.
 * Revoking it would sign the reader out mid-review, which is not what "sign out
 * my other devices" means, so the current session is labelled and has no revoke
 * button. `revokeOtherSessions` has the same guarantee server-side: it clears
 * every session except the caller's.
 */
interface SessionRow {
  id: string
  token: string
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
  expiresAt?: string | Date | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Human label for a stored User-Agent.
 *
 * Deliberately mirrors `deviceName()` in auth-service/src/auth.ts so the device
 * named in the "New sign-in" email matches the row the reader is looking for
 * here. Two copies of a browser sniff is a real cost, but the email is rendered
 * in a Worker this bundle cannot import from, and wording that disagrees between
 * the email and the list is worse than the duplication.
 */
function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const platform = /iPhone|iPad/.test(ua)
    ? 'iPhone or iPad'
    : /Android/.test(ua)
      ? 'Android device'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return platform ? `${browser} on ${platform}` : browser
}

/** Phones and tablets get their own glyph; everything else reads as a computer. */
function deviceIcon(ua: string | null | undefined): string {
  if (!ua) return 'devices'
  if (/iPhone|Android.*Mobile/.test(ua)) return 'smartphone'
  if (/iPad|Tablet/.test(ua)) return 'tablet'
  return 'computer'
}

function when(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function ActiveSessions() {
  const { data: current } = useSession()
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  const currentToken = current?.session?.token

  const load = useCallback(async () => {
    const res = await authClient.listSessions()
    setSessions((res?.data as SessionRow[] | undefined) ?? [])
  }, [])

  useEffect(() => {
    void load().catch(() => setSessions([]))
  }, [load])

  async function revoke(row: SessionRow) {
    setBusy(row.id)
    try {
      const res = await authClient.revokeSession({ token: row.token })
      if (res?.error) {
        notify.error(res.error.message || 'Could not sign that device out')
        return
      }
      notify.success('Signed that device out')
      await load()
    } catch (e) {
      notify.error((e as Error)?.message || 'Could not sign that device out')
    } finally {
      setBusy(null)
    }
  }

  async function revokeOthers() {
    setBusy('all')
    try {
      const res = await authClient.revokeOtherSessions()
      if (res?.error) {
        notify.error(res.error.message || 'Could not sign your other devices out')
        return
      }
      notify.success('Signed out everywhere else')
      setConfirmAll(false)
      await load()
    } catch (e) {
      notify.error((e as Error)?.message || 'Could not sign your other devices out')
    } finally {
      setBusy(null)
    }
  }

  const rows = sessions ?? []
  // The session whose token matches ours is the browser reading this page. Better
  // Auth returns no particular order, so surface it first: it is the anchor the
  // reader checks every other row against.
  const sorted = [...rows].sort((a, b) => {
    if (a.token === currentToken) return -1
    if (b.token === currentToken) return 1
    return 0
  })
  const others = rows.filter((r) => r.token !== currentToken).length
  const othersLabel = others === 1 ? 'the other device' : 'all ' + others + ' other devices'

  return (
    <section className="account-security-card">
      <div className="account-card-heading">
        <span className="account-card-icon" aria-hidden="true">
          <Icon name="devices" />
        </span>
        <div className="account-card-title">
          <h3>Where you are signed in</h3>
          <AccountInfoTip text="Every browser and device signed in to your account. If you see one you do not recognize, sign it out and change your password." />
        </div>
      </div>

      {sessions === null ? (
        <p className="t-muted mt-4 text-[13px]">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="t-muted mt-4 text-[13px]">No other devices are signed in.</p>
      ) : (
        <ul className="auth-method-list">
          {sorted.map((row) => {
            const isCurrent = row.token === currentToken
            const seen = when(row.updatedAt) || when(row.createdAt)
            const detail = [row.ipAddress || null, seen ? 'last used ' + seen : null]
              .filter(Boolean)
              .join(' - ')
            return (
              <li key={row.id} className="auth-method-row">
                <span className="auth-provider-mark" aria-hidden="true">
                  <Icon name={deviceIcon(row.userAgent)} />
                </span>
                <span className="auth-method-copy">
                  <strong>{deviceLabel(row.userAgent)}</strong>
                  <span
                    className={isCurrent ? 'auth-method-status connected' : 'auth-method-status'}
                  >
                    {isCurrent ? 'This device' : detail || 'Signed in'}
                  </span>
                </span>
                {isCurrent ? null : (
                  <button
                    type="button"
                    className="btn-sm btn-ghost danger"
                    onClick={() => void revoke(row)}
                    disabled={busy === row.id}
                    aria-label={'Sign out ' + deviceLabel(row.userAgent)}
                  >
                    Sign out
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {others > 0 ? (
        <button
          type="button"
          className="btn-secondary mt-4 self-start"
          onClick={() => setConfirmAll(true)}
          disabled={busy !== null}
        >
          Sign out all other devices
        </button>
      ) : null}

      {confirmAll ? (
        <ConfirmDialog
          title="Sign out everywhere else?"
          message={'This signs out ' + othersLabel + '. You will stay signed in here.'}
          confirmLabel="Sign them out"
          busy={busy === 'all'}
          onConfirm={() => void revokeOthers()}
          onCancel={() => setConfirmAll(false)}
        />
      ) : null}
    </section>
  )
}
