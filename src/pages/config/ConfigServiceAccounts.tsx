import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUsers,
  getApiKeys,
  createApiKey,
  deleteApiKey,
  createUser,
  updateUser,
  deleteUser,
  getServiceAccountIds,
  tagServiceAccount,
  untagServiceAccount,
  adminKeys,
  adminSectionKeys,
  type ABSAdminUser,
  type ABSApiKey,
} from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'
import { getMe } from '@/api/absLibrary'
import { AbsError } from '@/api/absClient'
import type { UserFormSubmit } from '@/components/config/UserForm'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fmtSessDate } from '@/lib/format'
import { Icon } from '@/components/common/Icon'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { UserForm } from '@/components/config/UserForm'
import { Modal } from '@/components/common/Modal'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Generate a strong random password the admin can hand to an app, the way a
// password manager would. Uses crypto.getRandomValues over an unambiguous
// alphabet (no look-alike 0/O, 1/l/I) and rejection-samples to avoid modulo bias.
function generatePassword(length = 20): string {
  const alphabet =
    'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_'
  const max = Math.floor(256 / alphabet.length) * alphabet.length
  const out: string[] = []
  const buf = new Uint8Array(1)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    const byte = buf[0]
    if (byte !== undefined && byte < max) out.push(alphabet[byte % alphabet.length] as string)
  }
  return out.join('')
}

// A reveal-once secret block (API token or generated password). The value is
// shown plainly with select-all so the admin can copy it before dismissing.
function SecretReveal({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context); the select-all field still works.
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div
        className="fld"
        style={{
          flex: 1,
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
      >
        {value}
      </div>
      <button className="btn-sm btn-ghost" onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'content_copy'} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// Per-account API key management, revealed when a service-account row is expanded.
function AccountKeys({
  target,
  account,
  canCreate,
}: {
  target: AbsTarget
  account: ABSAdminUser
  canCreate: boolean
}) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<ABSApiKey | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminSectionKeys.apiKeys(target.serverId),
    queryFn: () => getApiKeys(target),
    staleTime: 60 * 1000,
  })

  const keys = (data?.apiKeys ?? []).filter((k) => k.userId === account.id)

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setCreateError(null)
    try {
      const res = await createApiKey(target, name, account.id)
      setCreatedToken(res.apiKey.apiKey ?? null)
      setNewName('')
      setCreating(false)
      qc.invalidateQueries({ queryKey: adminSectionKeys.apiKeys(target.serverId) })
    } catch (e) {
      setCreateError(e instanceof AbsError ? e.message : 'Could not create token.')
    }
  }
  const revoke = async (k: ABSApiKey) => {
    await deleteApiKey(target, k.id)
    qc.invalidateQueries({ queryKey: adminSectionKeys.apiKeys(target.serverId) })
  }

  return (
    <div style={{ padding: '4px 0 8px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          API tokens for {account.username}
        </span>
        {canCreate && (
          <button className="btn-sm btn-accent" onClick={() => setCreating(true)}>
            <Icon name="add" /> New token
          </button>
        )}
      </div>

      {!canCreate && (
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: '4px 0 10px' }}>
          <Icon name="info" style={{ verticalAlign: '-3px' }} /> This is a root
          account. Only a root user can mint tokens under it - sign in as root, or
          create a separate service account for app access.
        </p>
      )}

      {isLoading && <LoadingSpinner className="py-6" label="Loading tokens..." />}
      {isError && <ErrorState message="Could not load tokens." onRetry={refetch} />}

      {data && keys.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: '4px 0' }}>
          No tokens yet. Create one to let another app sign in as this account.
        </p>
      )}

      {data && keys.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600 }}>{k.name}</td>
                  <td className="num">
                    {fmtSessDate(new Date(k.createdAt).getTime()).day}
                  </td>
                  <td className="num">
                    {k.lastUsedAt ? fmtSessDate(k.lastUsedAt).day : 'never'}
                  </td>
                  <td>
                    {k.isActive ? (
                      <span style={{ color: '#a7c896' }}>Active</span>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>Inactive</span>
                    )}
                  </td>
                  <td>
                    <div className="t-actions">
                      <button
                        className="tbl-icon"
                        title="Revoke token"
                        onClick={() => setPendingRevoke(k)}
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal
          title="New API token"
          onClose={() => setCreating(false)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="btn-sm btn-green" onClick={() => void create()}>
                <Icon name="key" /> Create token
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
            Mints a token under <strong>{account.username}</strong>. The app you
            give it to acts as this account.
          </p>
          {createError && (
            <p
              style={{
                fontSize: 13,
                color: '#e8897f',
                background: 'color-mix(in oklab, #d8443a 14%, transparent)',
                border: '1px solid color-mix(in oklab, #d8443a 40%, transparent)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              {createError}
            </p>
          )}
          <div className="field full">
            <label>Token name</label>
            <input
              className="fld"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Backup script"
            />
          </div>
        </Modal>
      )}

      {createdToken && (
        <Modal
          title="API token created"
          onClose={() => setCreatedToken(null)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-green"
                onClick={() => setCreatedToken(null)}
              >
                Done
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
            Copy this token now - it won't be shown again.
          </p>
          <SecretReveal value={createdToken} />
        </Modal>
      )}

      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke API token"
          message={`Revoke "${pendingRevoke.name}"? Anything using this token will stop working immediately.`}
          confirmLabel="Revoke token"
          danger
          onConfirm={() => void revoke(pendingRevoke)}
          onClose={() => setPendingRevoke(null)}
        />
      )}
    </div>
  )
}

export function ConfigServiceAccounts() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', email: '' })
  const [showPw, setShowPw] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{
    username: string
    password: string
  } | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [pendingUntag, setPendingUntag] = useState<ABSAdminUser | null>(null)
  const [editing, setEditing] = useState<ABSAdminUser | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ABSAdminUser | null>(null)
  // Bump to re-read the localStorage tag set after tag/untag.
  const [tagVersion, setTagVersion] = useState(0)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const callerIsRoot = me?.type === 'root'

  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    refetch,
  } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const trackedIds = useMemo(
    () => new Set(target ? getServiceAccountIds(target) : []),
    [target, tagVersion]
  )

  // A service account is any account an admin tagged here. They are regular ABS
  // admin users; the tag is a local grouping persisted per server.
  const accounts = useMemo(() => {
    const users = usersData?.users ?? []
    return users.filter((u) => trackedIds.has(u.id))
  }, [usersData, trackedIds])

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const submitCreate = async () => {
    const username = form.username.trim()
    const password = form.password
    if (!username || !password) return
    setAddError(null)
    try {
      const res = await createUser(target, {
        username,
        password,
        email: form.email.trim() || null,
        type: 'admin',
      })
      tagServiceAccount(target, res.user.id)
      setTagVersion((v) => v + 1)
      setCreatedCreds({ username, password })
      setForm({ username: '', password: '', email: '' })
      setAdding(false)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
    } catch (e) {
      setAddError(e instanceof AbsError ? e.message : 'Could not create account')
    }
  }

  const untag = (u: ABSAdminUser) => {
    untagServiceAccount(target, u.id)
    setTagVersion((v) => v + 1)
  }

  const saveEdit = async (values: UserFormSubmit) => {
    if (!editing) return
    setEditBusy(true)
    setEditError(null)
    try {
      await updateUser(target, editing.id, values)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      setEditing(null)
    } catch (e) {
      setEditError(e instanceof AbsError ? e.message : 'Could not save changes')
    } finally {
      setEditBusy(false)
    }
  }

  // Permanently delete the underlying ABS account (and its tokens), then drop the
  // local tag. ABS forbids deleting root, so the root account never offers it.
  const doDelete = async (u: ABSAdminUser) => {
    await deleteUser(target, u.id)
    untagServiceAccount(target, u.id)
    setTagVersion((v) => v + 1)
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
  }

  return (
    <>
      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Service Accounts</h1>
        </div>
        <button
          className="btn-sm btn-accent"
          onClick={() => {
            setForm({ username: '', password: '', email: '' })
            setShowPw(false)
            setAddError(null)
            setAdding(true)
          }}
        >
          <Icon name="add" /> New service account
        </button>
      </div>

      <p
        style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          margin: '0 0 18px',
          maxWidth: 620,
        }}
      >
        Service accounts are machine logins, not people. Use them to give another
        app its own API token instead of sharing your personal one. They are
        regular AudiobookShelf admin accounts - native ABS clients still see them
        in the full user list.
      </p>

      {usersLoading && (
        <LoadingSpinner className="py-12" label="Loading accounts..." />
      )}
      {usersError && (
        <ErrorState message="Could not load accounts." onRetry={refetch} />
      )}

      {usersData && accounts.length === 0 && (
        <div className="empty-state">
          <Icon name="smart_toy" />
          <h3>No service accounts</h3>
          <p>Create one to hand out a scoped API token to another app.</p>
        </div>
      )}

      {usersData && accounts.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th>Last seen</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((u) => {
                const isRoot = u.type === 'root'
                const open = expanded === u.id
                return (
                  <Fragment key={u.id}>
                    <tr>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <span className="av">{initials(u.username)}</span>
                          <span style={{ fontWeight: 600 }}>{u.username}</span>
                          <span className="tag-pill admin">Service</span>
                        </div>
                      </td>
                      <td className="num">
                        {u.lastSeen ? fmtSessDate(u.lastSeen).day : 'never'}
                      </td>
                      <td>
                        {u.isActive ? (
                          <span style={{ color: '#a7c896' }}>
                            <span className="online-dot" /> Active
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>
                            Disabled
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="t-actions">
                          <button
                            className={'tbl-icon' + (open ? ' on' : '')}
                            title="Manage API tokens"
                            onClick={() => setExpanded(open ? null : u.id)}
                          >
                            <Icon name="key" />
                          </button>
                          <button
                            className="tbl-icon"
                            title="Edit account"
                            onClick={() => {
                              setEditError(null)
                              setEditing(u)
                            }}
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            className="tbl-icon"
                            title="Remove from service accounts"
                            onClick={() => setPendingUntag(u)}
                          >
                            <Icon name="playlist_remove" />
                          </button>
                          {!isRoot && (
                            <button
                              className="tbl-icon"
                              title="Delete account"
                              onClick={() => setPendingDelete(u)}
                            >
                              <Icon name="delete" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--fill)' }}>
                          <AccountKeys
                            target={target}
                            account={u}
                            canCreate={!isRoot || callerIsRoot}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal
          title="New service account"
          onClose={() => setAdding(false)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button
                className="btn-sm btn-green"
                onClick={() => void submitCreate()}
              >
                <Icon name="smart_toy" /> Create account
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
            Creates an AudiobookShelf admin account dedicated to another app. Pick
            a password you can hand off - it is shown once here, then only the API
            tokens you mint under it matter.
          </p>
          {addError && (
            <p
              style={{
                fontSize: 13,
                color: '#e8897f',
                background: 'color-mix(in oklab, #d8443a 14%, transparent)',
                border: '1px solid color-mix(in oklab, #d8443a 40%, transparent)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              {addError}
            </p>
          )}
          <div className="field full">
            <label>Username</label>
            <input
              className="fld"
              value={form.username}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="e.g. backup-bot"
            />
          </div>
          <div className="field full">
            <label>Password</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                className="fld"
                style={{ flex: 1 }}
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Choose a strong password"
              />
              <button
                className="btn-sm btn-ghost"
                type="button"
                title={showPw ? 'Hide password' : 'Show password'}
                onClick={() => setShowPw((v) => !v)}
              >
                <Icon name={showPw ? 'visibility_off' : 'visibility'} />
              </button>
              <button
                className="btn-sm btn-ghost"
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, password: generatePassword() }))
                  setShowPw(true)
                }}
              >
                <Icon name="casino" /> Generate
              </button>
            </div>
          </div>
          <div className="field full">
            <label>Email (optional)</label>
            <input
              className="fld"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="optional"
            />
          </div>
        </Modal>
      )}

      {createdCreds && (
        <Modal
          title="Service account created"
          onClose={() => setCreatedCreds(null)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-green"
                onClick={() => setCreatedCreds(null)}
              >
                Done
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
            <strong>{createdCreds.username}</strong> is ready. Save its password
            now - it won't be shown again. Expand the account to mint API tokens.
          </p>
          <SecretReveal value={createdCreds.password} />
        </Modal>
      )}

      {pendingUntag && (
        <ConfirmDialog
          title="Remove from service accounts"
          message={`Move "${pendingUntag.username}" back to the Users list? The account and its tokens are not deleted - it just stops being grouped here.`}
          confirmLabel="Remove"
          onConfirm={() => {
            untag(pendingUntag)
            setPendingUntag(null)
          }}
          onClose={() => setPendingUntag(null)}
        />
      )}

      {editing && (
        <UserForm
          target={target}
          user={editing}
          busy={editBusy}
          error={editError}
          onSubmit={(v) => void saveEdit(v)}
          onClose={() => {
            setEditing(null)
            setEditError(null)
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete service account"
          message={`Permanently delete "${pendingDelete.username}"? This removes the AudiobookShelf account and every API token under it. Apps using those tokens stop working immediately. This cannot be undone.`}
          confirmLabel="Delete account"
          danger
          onConfirm={() => void doDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
