import { Link, Outlet } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Wordmark } from '@/components/Wordmark'

/**
 * The app shell. The single-server HS app has a library sidebar here; the
 * front door's distinguishing shell is the top bar with the wordmark linking
 * back to the server picker. Per-server chrome mounts inside <Outlet />.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-sidebar px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/flame.png"
            alt=""
            className="size-6 [filter:drop-shadow(0_0_10px_color-mix(in_oklab,var(--brand-hearth)_50%,transparent))]"
          />
          <Wordmark />
        </Link>
        <UserButton afterSignOutUrl="/sign-in" />
      </header>
      <main className="flex-1 px-5 py-8">
        <Outlet />
      </main>
    </div>
  )
}
