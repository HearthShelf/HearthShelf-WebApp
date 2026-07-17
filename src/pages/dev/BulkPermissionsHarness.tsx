import { useState } from 'react'
import { BulkPermissionsModal } from '@/components/config/BulkPermissionsModal'
import type { ABSAdminUser } from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'

// DEV-ONLY visual harness for the bulk permissions modal. Renders the modal
// with fake users and a dead target (library/tag queries fail to their empty
// states) so the layout can be eyeballed without Clerk or a live ABS server.
// Gated to import.meta.env.DEV in the router.
const fakeTarget = { serverId: 'dev', baseUrl: 'http://127.0.0.1:1', token: 'x' } as AbsTarget

const fakeUsers = [
  { id: '1', username: 'jaime', type: 'user', isActive: true },
  { id: '2', username: 'alex', type: 'admin', isActive: true },
  { id: '3', username: 'root', type: 'root', isActive: true },
] as ABSAdminUser[]

export function BulkPermissionsHarness() {
  const [open, setOpen] = useState(true)
  const [last, setLast] = useState<string>('')

  return (
    <div className="dark" style={{ minHeight: '100vh', background: 'var(--background)', padding: 40 }}>
      <button className="btn-sm btn-accent" onClick={() => setOpen(true)}>
        Open bulk modal
      </button>
      {last && <pre style={{ color: 'var(--text-muted)', fontSize: 12 }}>{last}</pre>}
      {open && (
        <BulkPermissionsModal
          target={fakeTarget}
          users={fakeUsers}
          onSubmit={(v) => {
            setLast(JSON.stringify(v, null, 2))
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
