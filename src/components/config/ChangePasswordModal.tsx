import { useState } from 'react'
import type { ABSAdminUser } from '@/api/absAdmin'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

interface ChangePasswordModalProps {
  user: ABSAdminUser
  busy?: boolean
  error?: string | null
  onSubmit: (password: string) => void
  onClose: () => void
}

// Password reset, split out of the old all-in-one UserForm into its own modal.
export function ChangePasswordModal({
  user,
  busy,
  error,
  onSubmit,
  onClose,
}: ChangePasswordModalProps) {
  const isRoot = user.type === 'root'
  const [password, setPassword] = useState('')

  const submit = () => {
    if (!password) return
    onSubmit(password)
  }

  return (
    <Modal
      title={`Reset password - ${user.username}`}
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-sm btn-green" disabled={busy || !password} onClick={submit}>
            <Icon name="save" /> Save password
          </button>
        </>
      }
    >
      {error && <p className="form-err">{error}</p>}
      {isRoot && (
        <p className="hint" style={{ marginTop: 0, color: 'var(--text-muted)' }}>
          This is a root account. Only another root user can change its password.
        </p>
      )}

      <div className="field full">
        <label>New password</label>
        <input
          className="fld"
          type="text"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Choose a new password"
        />
      </div>
    </Modal>
  )
}
