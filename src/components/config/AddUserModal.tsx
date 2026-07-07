import { useState } from 'react'
import type { UserFormSubmit } from '@/components/config/UserForm'
import { UserFormFields } from '@/components/config/UserForm'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

interface AddUserModalProps {
  target: AbsTarget
  canInvite: boolean
  busy?: boolean
  error?: string | null
  onInvite: (email: string, role: 'admin' | 'user') => void
  onCreate: (values: UserFormSubmit) => void
  onClose: () => void
}

// Combines the two ways to add a person into one modal. Invite is the default
// when the server is paired with app.hearthshelf.com (no password to set,
// they choose their own on sign-up); Manual creation is always available and
// is the only option when the server isn't paired.
export function AddUserModal({
  target,
  canInvite,
  busy,
  error,
  onInvite,
  onCreate,
  onClose,
}: AddUserModalProps) {
  const [mode, setMode] = useState<'invite' | 'manual'>(canInvite ? 'invite' : 'manual')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user')

  const submitInvite = () => {
    const trimmed = inviteEmail.trim()
    if (!trimmed) return
    onInvite(trimmed, inviteRole)
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {mode === 'invite' ? (
            <button
              className="btn-sm btn-green"
              disabled={busy || !inviteEmail.trim()}
              onClick={submitInvite}
            >
              <Icon name="send" /> {busy ? 'Sending...' : 'Send invite'}
            </button>
          ) : (
            <button
              className="btn-sm btn-green"
              disabled={busy}
              type="submit"
              form="add-user-manual-form"
            >
              <Icon name="person_add" /> Create user
            </button>
          )}
        </>
      }
    >
      {canInvite && (
        <div className="seg seg-full" style={{ marginBottom: 'var(--s4)' }}>
          <button
            type="button"
            className={mode === 'invite' ? 'on' : ''}
            onClick={() => setMode('invite')}
          >
            Invite by email
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'on' : ''}
            onClick={() => setMode('manual')}
          >
            Create manually
          </button>
        </div>
      )}

      {error && <p className="form-err">{error}</p>}

      {mode === 'invite' ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            They'll get an email to create a HearthShelf account, then this server appears for them
            automatically.
          </p>
          <div className="field full">
            <label>Email address</label>
            <input
              className="fld"
              type="email"
              autoFocus
              placeholder="name@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="field full">
            <label>Role</label>
            <select
              className="fld"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </>
      ) : (
        <UserFormFields formId="add-user-manual-form" target={target} onSubmit={onCreate} />
      )}
    </Modal>
  )
}
