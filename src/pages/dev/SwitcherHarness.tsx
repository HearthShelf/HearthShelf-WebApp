import { useEffect } from 'react'
import { AccountSwitcher } from '@/components/account/AccountSwitcher'
import { useRememberedAccounts } from '@/store/rememberedAccounts'

// DEV-ONLY visual harness for the account switcher menu. Seeds a couple of
// remembered accounts and renders the shared AccountSwitcher inside the same
// .user-menu shell the sidebar uses, so the roster/rows/PIN-lock styling can be
// eyeballed without Clerk. Gated to import.meta.env.DEV in the router.
export function SwitcherHarness() {
  const setAll = useRememberedAccounts((s) => s.setAll)
  useEffect(() => {
    setAll([
      { handle: 'h_jaime', userId: 'u_jaime', label: 'Jaime', hasPin: true },
      { handle: 'h_alex', userId: 'u_alex', label: 'Alex Rivera', hasPin: false },
    ])
  }, [setAll])

  return (
    <div
      className="dark"
      style={{
        minHeight: '100vh',
        background: 'var(--background)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div className="user-wrap" style={{ width: 280, position: 'relative' }}>
        <div className="user-menu" style={{ position: 'static' }}>
          <AccountSwitcher onNavigate={(to) => alert('navigate ' + to)} showAdmin />
        </div>
      </div>
    </div>
  )
}
