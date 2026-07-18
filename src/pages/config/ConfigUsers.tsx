import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUsers,
  getOnlineUserIds,
  getLastSeenByUser,
  deleteUser,
  setUserActive,
  createUser,
  updateUser,
  getServiceAccountIds,
  serviceAccountKeys,
  adminKeys,
} from '@/api/absAdmin'
import type { ABSAdminUser } from '@/api/absAdmin'
import { getMe } from '@/api/absLibrary'
import {
  recoverAdmins,
  getServerRuntime,
  getHostedStatus,
  inviteFromServer,
  getPendingInvites,
  hostedKeys,
} from '@/api/absHosted'
import type { UserFormSubmit } from '@/components/config/UserForm'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useToast } from '@/hooks/useToast'
import { friendlyError } from '@/lib/errorMessages'
import { fmtSessDate } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { AddUserModal } from '@/components/config/AddUserModal'
import {
  BulkPermissionsModal,
  type BulkPermissionsValues,
} from '@/components/config/BulkPermissionsModal'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

export function ConfigUsers() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target, server } = useActiveServer()
  const [pendingDelete, setPendingDelete] = useState<ABSAdminUser | null>(null)
  const [pendingDisable, setPendingDisable] = useState<ABSAdminUser | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [recoverOpen, setRecoverOpen] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const { data: hostedStatus } = useQuery({
    queryKey: hostedKeys.status(target?.serverId ?? ''),
    queryFn: () => getHostedStatus(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const { data: pendingInvites, refetch: refetchInvites } = useQuery({
    queryKey: hostedKeys.invites(target?.serverId ?? ''),
    queryFn: () => getPendingInvites(target!),
    enabled: Boolean(target) && Boolean(hostedStatus?.paired),
    staleTime: 30 * 1000,
    retry: false,
  })

  // Resending is just re-inviting the same email - the backend upserts the
  // pending invite and re-attempts the Clerk email either way.
  const [resendingEmail, setResendingEmail] = useState<string | null>(null)
  const invite = useMutation({
    mutationFn: (opts: { email: string; role: 'admin' | 'user' }) =>
      inviteFromServer(target!, opts.email, opts.role),
    onSuccess: (r) => {
      show(
        resendingEmail
          ? r.emailed
            ? `Invite resent to ${r.email}`
            : `Invite recorded for ${r.email}`
          : r.emailed
            ? `Invited ${r.email} - email sent`
            : `Invited ${r.email}`,
      )
      if (!resendingEmail) setAdding(false)
      setResendingEmail(null)
      void refetchInvites()
    },
    onError: (e: Error) => {
      show(friendlyError(e, resendingEmail ? 'Could not resend invite' : 'Invite failed'))
      setResendingEmail(null)
    },
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Live presence: users with an open socket OR an active playback session (see
  // getOnlineUserIds - app users stream over REST, so the session is the real
  // signal). isActive on the user record is the account-enabled flag, not
  // presence, so the Status column reads online state from here. Polls.
  const { data: onlineIds } = useQuery({
    queryKey: adminKeys.usersOnline(target?.serverId ?? ''),
    queryFn: () => getOnlineUserIds(target!),
    enabled: Boolean(target),
    refetchInterval: 30 * 1000,
  })

  // Real per-user "last seen" from listening sessions, since ABS's user.lastSeen
  // only updates on a websocket login that app users never make.
  const { data: lastSeenByUser } = useQuery({
    queryKey: adminKeys.lastSeen(target?.serverId ?? ''),
    queryFn: () => getLastSeenByUser(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // The signed-in admin, so we can stop them disabling or deleting their own
  // account (which would lock them out with no in-app way back).
  const { data: me } = useQuery({
    queryKey: ['me', target?.serverId ?? ''],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Service accounts are machine logins, not people. They live on their own
  // Config page, so keep them out of this human-user list. The tagged-id set is
  // owned by the connected server's HearthShelf backend (/hs/service-accounts),
  // so it's consistent across devices and survives restarts. ABS itself exposes
  // no distinct non-human user type - service accounts are regular admin users -
  // so the tagged ids are what we filter on.
  const { data: trackedData } = useQuery({
    queryKey: serviceAccountKeys.ids(target?.serverId ?? ''),
    queryFn: () => getServiceAccountIds(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // The box's runtime config carries `serviceUsername` - the auto-created
  // HearthShelf service root (AIO). It's a regular ABS admin user, so ABS lists
  // it here, but it isn't in the tagged-id set (that only holds hand-tagged ids).
  // We filter it by username so the machine account never shows up as a person.
  const { data: runtime } = useQuery({
    queryKey: hostedKeys.runtime(target?.serverId ?? ''),
    queryFn: () => getServerRuntime(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const serviceUsername = runtime?.serviceUsername ?? null

  const serviceUserIds = useMemo(() => new Set(trackedData?.ids ?? []), [trackedData])
  const allUsers = data?.users ?? []
  const users = allUsers.filter(
    (u) => !serviceUserIds.has(u.id) && !(serviceUsername != null && u.username === serviceUsername),
  )
  const serviceCount = allUsers.length - users.length
  // Disabled admin/root accounts - the trigger for the break-glass recovery card.
  const disabledAdmins = users.filter(
    (u) => (u.type === 'admin' || u.type === 'root') && !u.isActive,
  )

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const isSelf = (u: ABSAdminUser) => me?.id === u.id

  // Enabling is harmless and immediate. Disabling is gated: never your own
  // account, and always behind a confirm so it can't happen on a stray click.
  const onToggleActive = (u: ABSAdminUser) => {
    if (isSelf(u)) {
      show("You can't disable your own account.")
      return
    }
    if (u.isActive) {
      setPendingDisable(u)
    } else {
      void setActive(u, true)
    }
  }
  const setActive = async (u: ABSAdminUser, isActive: boolean) => {
    await setUserActive(target, u.id, isActive)
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
    show(isActive ? `Enabled ${u.username}` : `Disabled ${u.username}`)
  }
  const doDelete = async (u: ABSAdminUser) => {
    await deleteUser(target, u.id)
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
    show(`Deleted ${u.username}`)
  }

  const doRecover = async () => {
    setRecovering(true)
    try {
      const r = await recoverAdmins(target)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      show(
        r.count > 0
          ? `Re-enabled ${r.count} admin ${r.count === 1 ? 'account' : 'accounts'}`
          : 'No disabled admins to recover',
      )
    } catch (e) {
      show(friendlyError(e, 'Could not recover admin access.'))
    } finally {
      setRecovering(false)
      setRecoverOpen(false)
    }
  }

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectedUsers = users.filter((u) => selected.has(u.id))
  const allSelected = users.length > 0 && selectedUsers.length === users.length
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)))

  // Applies the chosen type/enabled/permissions to every selected user, one
  // PATCH per user. Guards: never disable yourself, never change a root
  // account's type (ABS rejects it). Partial failures are reported by name.
  const applyBulk = async (values: BulkPermissionsValues) => {
    setBulkBusy(true)
    setBulkError(null)
    const failed: string[] = []
    for (const u of selectedUsers) {
      const patch: Parameters<typeof updateUser>[2] = {
        permissions: values.permissions,
        isActive: isSelf(u) ? true : values.isActive,
      }
      if (u.type !== 'root') patch.type = values.type
      try {
        await updateUser(target, u.id, patch)
      } catch {
        failed.push(u.username)
      }
    }
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
    setBulkBusy(false)
    if (failed.length > 0) {
      setBulkError(`Could not update: ${failed.join(', ')}`)
    } else {
      const skippedSelf = !values.isActive && selectedUsers.some((u) => isSelf(u))
      setBulkOpen(false)
      setSelected(new Set())
      show(
        `Updated ${selectedUsers.length} ${selectedUsers.length === 1 ? 'user' : 'users'}` +
          (skippedSelf ? ' (your own account stays enabled)' : ''),
      )
    }
  }

  const create = async (values: UserFormSubmit) => {
    if (!values.password) return
    setBusy(true)
    setFormError(null)
    try {
      await createUser(target, { ...values, password: values.password })
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      setAdding(false)
      show(`Created ${values.username}`)
    } catch (e) {
      // ABS returns a plain-language reason (e.g. "Username already taken").
      setFormError(e instanceof Error ? e.message : 'Could not create user')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Users</h1>
        </div>
        <button className="btn-sm btn-accent" onClick={() => setAdding(true)}>
          <Icon name="add" /> Add user
        </button>
      </div>

      {!hostedStatus?.paired && (
        <div className="banner info" style={{ marginBottom: 'var(--s6)' }}>
          <Icon name="info" />
          Connect this server to app.hearthshelf.com (see HearthShelf Connect) to invite people by
          email instead of creating accounts manually.
        </div>
      )}

      {pendingInvites && pendingInvites.length > 0 && (
        <div className="cfg-card" style={{ marginBottom: 'var(--s6)' }}>
          <div className="sr-t" style={{ marginBottom: 'var(--s2)' }}>
            Pending invites
          </div>
          {pendingInvites.map((inv) => (
            <div className="set-row" key={inv.email}>
              <div className="sr-meta">
                <div className="sr-t">{inv.email}</div>
                <div className="sr-d">
                  {inv.role} · invited {fmtSessDate(inv.created_at).day}
                </div>
              </div>
              <button
                className="btn-sm btn-ghost"
                disabled={invite.isPending}
                onClick={() => {
                  setResendingEmail(inv.email)
                  invite.mutate({ email: inv.email, role: inv.role })
                }}
              >
                <Icon name="send" /> Resend
              </button>
            </div>
          ))}
        </div>
      )}

      {serviceCount > 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
          <Icon name="smart_toy" style={{ verticalAlign: '-3px' }} /> {serviceCount} machine{' '}
          {serviceCount === 1 ? 'account is' : 'accounts are'} hidden here.{' '}
          <span className="lnk" onClick={() => navigate('/config/service-accounts')}>
            Manage service accounts
          </span>
        </p>
      )}

      {isLoading && <LoadingSpinner className="py-12" label="Loading users..." />}
      {isError && <ErrorState message="Could not load users." onRetry={refetch} />}

      {selectedUsers.length > 0 && (
        <div
          className="cfg-card"
          style={{
            marginBottom: 'var(--s4)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {selectedUsers.length} selected
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button className="btn-sm btn-accent" onClick={() => setBulkOpen(true)}>
            <Icon name="key" /> Edit permissions
          </button>
        </div>
      )}

      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all users"
                  />
                </th>
                <th>User</th>
                <th>Type</th>
                <th>Last seen</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      aria-label={`Select ${u.username}`}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={u.username} target={target} userId={u.id} size={30} />
                      <span className="lnk" onClick={() => navigate(`/config/users/${u.id}`)}>
                        {u.username}
                      </span>
                    </div>
                  </td>
                  <td>{u.type}</td>
                  <td className="num">
                    {(() => {
                      // Most recent of ABS's record lastSeen and the session-
                      // derived activity (the latter is what app users actually
                      // generate). Online right now reads as "Now".
                      if (onlineIds?.has(u.id)) return 'Now'
                      const seen = Math.max(u.lastSeen ?? 0, lastSeenByUser?.get(u.id) ?? 0)
                      return seen > 0 ? fmtSessDate(seen).day : 'never'
                    })()}
                  </td>
                  <td>
                    {!u.isActive ? (
                      <span style={{ color: 'var(--primary)' }}>
                        <Icon name="block" style={{ fontSize: 15, verticalAlign: '-3px' }} />{' '}
                        Disabled
                      </span>
                    ) : onlineIds?.has(u.id) ? (
                      <span style={{ color: '#a7c896' }}>
                        <span className="online-dot" /> Online
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>
                        <span className="online-dot off" /> Offline
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="t-actions">
                      <button
                        className="tbl-icon"
                        title="Edit user"
                        onClick={() => navigate(`/config/users/${u.id}`)}
                      >
                        <Icon name="edit" />
                      </button>
                      {!isSelf(u) && (
                        <button
                          className="tbl-icon"
                          title={u.isActive ? 'Disable' : 'Enable'}
                          onClick={() => onToggleActive(u)}
                        >
                          <Icon name={u.isActive ? 'block' : 'check_circle'} />
                        </button>
                      )}
                      {u.type !== 'root' && !isSelf(u) && (
                        <button
                          className="tbl-icon"
                          title="Delete user"
                          onClick={() => setPendingDelete(u)}
                        >
                          <Icon name="delete" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {disabledAdmins.length > 0 && (
        <div
          className="cfg-card"
          style={{
            marginTop: 'var(--s5)',
            borderColor: 'color-mix(in oklab, var(--primary) 40%, var(--hairline))',
          }}
        >
          <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
            <Icon name="lock_reset" style={{ color: 'var(--primary)', marginTop: 2 }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">Recover admin access</div>
              <div className="cl-d">
                {disabledAdmins.length === 1
                  ? '1 admin account is disabled.'
                  : `${disabledAdmins.length} admin accounts are disabled.`}{' '}
                If you've locked yourself out, this re-enables every disabled admin using this
                server's HearthShelf connection. Requires the server to be connected to HearthShelf.
              </div>
            </div>
            <button
              className="btn-sm btn-accent"
              style={{ flex: 'none' }}
              disabled={recovering}
              onClick={() => setRecoverOpen(true)}
            >
              <Icon name="lock_reset" /> {recovering ? 'Recovering...' : 'Recover admins'}
            </button>
          </div>
        </div>
      )}

      {recoverOpen && (
        <ConfirmDialog
          title="Recover admin access"
          message={`Re-enable all disabled admin accounts on "${server?.name ?? 'this server'}"? This uses this server's HearthShelf connection to restore admin sign-in.`}
          confirmLabel="Recover admins"
          onConfirm={() => void doRecover()}
          onClose={() => setRecoverOpen(false)}
        />
      )}

      {bulkOpen && (
        <BulkPermissionsModal
          target={target}
          users={selectedUsers}
          busy={bulkBusy}
          error={bulkError}
          onSubmit={(v) => void applyBulk(v)}
          onClose={() => {
            setBulkOpen(false)
            setBulkError(null)
          }}
        />
      )}

      {adding && (
        <AddUserModal
          target={target}
          canInvite={Boolean(hostedStatus?.paired)}
          busy={busy || invite.isPending}
          error={formError}
          onInvite={(email, role) => invite.mutate({ email, role })}
          onCreate={(v) => void create(v)}
          onClose={() => {
            setAdding(false)
            setFormError(null)
          }}
        />
      )}

      {pendingDisable && (
        <ConfirmDialog
          title="Disable user"
          message={`Disable "${pendingDisable.username}"? They won't be able to sign in until you enable the account again.`}
          confirmLabel="Disable user"
          danger
          onConfirm={() => void setActive(pendingDisable, false)}
          onClose={() => setPendingDisable(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete user"
          message={`Permanently delete "${pendingDelete.username}"? This removes their account and progress. This cannot be undone.`}
          confirmLabel="Delete user"
          danger
          onConfirm={() => void doDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
