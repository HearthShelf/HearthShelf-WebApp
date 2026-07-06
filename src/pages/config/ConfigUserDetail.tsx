import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, updateUser, adminKeys } from '@/api/absAdmin'
import { getLinkedAbsUserIds, hostedKeys } from '@/api/absHosted'
import { EditUserAccountModal, type EditUserAccountValues } from '@/components/config/EditUserAccountModal'
import { ChangePasswordModal } from '@/components/config/ChangePasswordModal'
import { EditPermissionsModal, type EditPermissionsValues } from '@/components/config/EditPermissionsModal'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fmtSessDate } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'

type EditMode = 'account' | 'password' | 'permissions' | null

export function ConfigUserDetail({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Box-local: which ABS users have signed in via app.hearthshelf.com. Failure
  // (unpaired, older box) just means we can't show link status - not an error.
  const { data: linkedIds } = useQuery({
    queryKey: hostedKeys.linkedUsers(target?.serverId ?? ''),
    queryFn: () => getLinkedAbsUserIds(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
  })

  const user = data?.users.find((u) => u.id === userId)

  if (!target || isLoading) {
    return <LoadingSpinner className="py-12" label="Loading user..." />
  }
  if (!user) {
    return (
      <div className="empty-state">
        <Icon name="person_off" />
        <h3>User not found</h3>
      </div>
    )
  }

  const linkedToHosted = linkedIds?.has(user.id) ?? false

  // Show only the boolean permission flags that are enabled (skip the array
  // fields librariesAccessible / itemTagsSelected, which aren't simple toggles).
  const perms = Object.entries(user.permissions ?? {}).filter(([, v]) => v === true)
  const seen = user.lastSeen ? fmtSessDate(user.lastSeen) : null

  const closeEdit = () => {
    setEditMode(null)
    setFormError(null)
  }

  const saveAccount = async (values: EditUserAccountValues) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, values)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Changes saved')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async (password: string) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, { password })
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Password changed')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not change password')
    } finally {
      setBusy(false)
    }
  }

  const savePermissions = async (values: EditPermissionsValues) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, values)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Permissions saved')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save permissions')
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
      <div className="crumb">
        <Link className="lnk" to="/config/users">
          Users
        </Link>
        <Icon name="chevron_right" />
        {user.username}
      </div>

      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin · User</div>
          <h1 className="title-xl">{user.username}</h1>
        </div>
        <div className="t-actions">
          <button className="btn-sm btn-ghost" onClick={() => setEditMode('permissions')}>
            <Icon name="key" /> Edit permissions
          </button>
          <button className="btn-sm btn-ghost" onClick={() => setEditMode('password')}>
            <Icon name="lock_reset" /> Reset password
          </button>
          <button className="btn-sm btn-accent" onClick={() => setEditMode('account')}>
            <Icon name="edit" /> Edit user account
          </button>
        </div>
      </div>

      <div className="cfg-card" style={{ marginBottom: 18 }}>
        <div className="cfg-line">
          <Icon name="account_circle" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta">
            <div className="cl-t">Profile</div>
          </div>
          <Avatar name={user.username} size={48} />
        </div>
      </div>

      <div className="cfg-card">
        {(
          [
            ['badge', 'Type', user.type],
            ['email', 'Email', user.email ?? '—'],
            ['toggle_on', 'Status', user.isActive ? 'Active' : 'Disabled'],
            ['lock', 'Locked', user.isLocked ? 'Yes' : 'No'],
            [
              'link',
              'hearthshelf.com account',
              linkedToHosted ? 'Connected' : 'Not connected',
            ],
            ['schedule', 'Last seen', seen ? `${seen.day} · ${seen.time}` : 'never'],
            ['calendar_today', 'Created', fmtSessDate(user.createdAt).day],
          ] as [string, string, string][]
        ).map(([icon, label, value]) => (
          <div className="cfg-line" key={label}>
            <Icon name={icon} style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta">
              <div className="cl-t">{label}</div>
            </div>
            <span
              style={{ color: label === 'hearthshelf.com account' && linkedToHosted ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {perms.length > 0 && (
        <>
          <div className="section-head">
            <Icon name="key" />
            <h2>Permissions</h2>
          </div>
          <div className="meta-chips">
            {perms.map(([k]) => (
              <span className="chip" key={k}>
                <Icon name="check" /> {k.replace(/^can/, '')}
              </span>
            ))}
          </div>
        </>
      )}

      {editMode === 'account' && (
        <EditUserAccountModal
          user={user}
          linkedToHosted={linkedToHosted}
          busy={busy}
          error={formError}
          onSubmit={(v) => void saveAccount(v)}
          onClose={closeEdit}
        />
      )}

      {editMode === 'password' && (
        <ChangePasswordModal
          user={user}
          busy={busy}
          error={formError}
          onSubmit={(v) => void savePassword(v)}
          onClose={closeEdit}
        />
      )}

      {editMode === 'permissions' && (
        <EditPermissionsModal
          target={target}
          user={user}
          busy={busy}
          error={formError}
          onSubmit={(v) => void savePermissions(v)}
          onClose={closeEdit}
        />
      )}
    </>
  )
}
