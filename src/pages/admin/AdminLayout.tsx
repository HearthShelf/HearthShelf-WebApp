import { Link, NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { fetchAdminMe, ApiError } from '@/api/controlPlane'
import { cn } from '@/lib/cn'

/**
 * Shell for the platform-admin area. Gates the whole section on fetchAdminMe:
 * the control plane (platform_admins D1 table) is the real authority - this is
 * only UI routing, so a non-admin who deep-links here gets a clean "not
 * authorized" panel instead of a broken page. Admin sub-pages render in the
 * <Outlet />; they can assume the caller is an admin.
 */
const TABS = [
  { to: '/admin/servers', label: 'Servers' },
  { to: '/admin/admins', label: 'Admins' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/logs', label: 'Infra logs' },
]

export function AdminLayout() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-me'],
    queryFn: fetchAdminMe,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
  })

  const forbidden = error instanceof ApiError && error.status === 403

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/"
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Your servers
      </Link>

      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-muted-foreground" />
        <div>
          <p className="t-eyebrow">Operations</p>
          <h1 className="t-h1 mt-1">Admin</h1>
        </div>
      </div>

      {isLoading ? (
        <Panel>
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Checking access...</span>
        </Panel>
      ) : forbidden || !data ? (
        <Panel>
          <ShieldAlert size={18} className="text-muted-foreground" />
          <span className="t-body">
            This area is limited to platform admins. Your account isn&apos;t on the admin roster.
          </span>
        </Panel>
      ) : (
        <>
          <nav className="mt-6 flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/admin/servers'}
                className={({ isActive }) =>
                  cn(
                    'border-b-2 px-3 py-2 text-[13px] -mb-px',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-6">
            <Outlet />
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
      {children}
    </div>
  )
}
