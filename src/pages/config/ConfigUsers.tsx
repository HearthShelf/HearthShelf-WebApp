import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUsers,
  deleteUser,
  setUserActive,
  createUser,
  adminKeys,
} from '@/api/absAdmin'
import type { ABSAdminUser } from '@/api/absAdmin'
import type { UserFormSubmit } from '@/components/config/UserForm'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useToast } from '@/hooks/useToast'
import { fmtSessDate } from '@/lib/format'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { UserForm } from '@/components/config/UserForm'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

export function ConfigUsers() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const [pendingDelete, setPendingDelete] = useState<ABSAdminUser | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const users = data?.users ?? []

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const toggleActive = async (u: ABSAdminUser) => {
    await setUserActive(target, u.id, !u.isActive)
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
  }
  const doDelete = async (u: ABSAdminUser) => {
    await deleteUser(target, u.id)
    qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
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

      {isLoading && <LoadingSpinner className="py-12" label="Loading users..." />}
      {isError && <ErrorState message="Could not load users." onRetry={refetch} />}

      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={u.username} size={30} />
                      <span className="lnk" onClick={() => navigate(`/config/users/${u.id}`)}>
                        {u.username}
                      </span>
                    </div>
                  </td>
                  <td>{u.type}</td>
                  <td className="num">
                    {u.lastSeen ? fmtSessDate(u.lastSeen).day : 'never'}
                  </td>
                  <td>
                    {u.isActive ? (
                      <span style={{ color: '#a7c896' }}>
                        <span className="online-dot" /> Active
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>Disabled</span>
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
                      <button
                        className="tbl-icon"
                        title={u.isActive ? 'Disable' : 'Enable'}
                        onClick={() => void toggleActive(u)}
                      >
                        <Icon name={u.isActive ? 'block' : 'check_circle'} />
                      </button>
                      {u.type !== 'root' && (
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

      {adding && (
        <UserForm
          target={target}
          busy={busy}
          error={formError}
          onSubmit={(v) => void create(v)}
          onClose={() => {
            setAdding(false)
            setFormError(null)
          }}
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
