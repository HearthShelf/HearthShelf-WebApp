import { useState } from 'react'
import type { ABSAdminUser } from '@/api/absAdmin'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

export interface EditUserAccountValues {
  username: string
  email: string | null
}

interface EditUserAccountModalProps {
  user: ABSAdminUser
  linkedToHosted: boolean
  busy?: boolean
  error?: string | null
  onSubmit: (values: EditUserAccountValues) => void
  onClose: () => void
}

// Username + email only. Split out of the old all-in-one UserForm so editing an
// account doesn't also surface password/permissions fields.
export function EditUserAccountModal({
  user,
  linkedToHosted,
  busy,
  error,
  onSubmit,
  onClose,
}: EditUserAccountModalProps) {
  const isRoot = user.type === 'root'
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  // Changing the email of an hs.com-linked account breaks the email match that
  // links it (resolveHostedContext matches by verified email), so require a
  // second deliberate click before the field can be edited.
  const [emailUnlocked, setEmailUnlocked] = useState(!linkedToHosted)

  const submit = () => {
    const name = username.trim()
    if (!name) return
    onSubmit({ username: name, email: email.trim() || null })
  }

  return (
    <Modal
      title={`Edit ${user.username}`}
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-sm btn-green" disabled={busy} onClick={submit}>
            <Icon name="save" /> Save changes
          </button>
        </>
      }
    >
      {error && <p className="form-err">{error}</p>}

      <div className="field full">
        <label>Username</label>
        <input
          className="fld"
          value={username}
          autoFocus
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. listener"
        />
      </div>

      <div className="field full">
        <label>Email</label>
        {linkedToHosted && !emailUnlocked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="fld" value={email} disabled style={{ flex: 1 }} />
            <button className="btn-sm btn-ghost" type="button" onClick={() => setEmailUnlocked(true)}>
              <Icon name="warning" /> Change anyway
            </button>
          </div>
        ) : (
          <input
            className="fld"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
          />
        )}
        {linkedToHosted && (
          <p className="hint" style={{ marginTop: 6 }}>
            This account is linked to app.hearthshelf.com. Changing the email breaks that link -
            they'll need to be re-invited to reconnect it.
          </p>
        )}
      </div>

      {isRoot && (
        <p className="hint" style={{ color: 'var(--text-muted)' }}>
          This is a root account.
        </p>
      )}
    </Modal>
  )
}
