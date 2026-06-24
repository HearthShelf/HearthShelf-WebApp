import { Link, Outlet } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Wordmark } from '@/components/Wordmark'

// AGPL-3.0 source offer (License section 13): the complete source of this hosted
// app must be available to its network users. Override at build time with
// VITE_SOURCE_URL if the repo moves.
const SOURCE_URL =
  import.meta.env.VITE_SOURCE_URL || 'https://github.com/Wutname1/HearthShelf-WebApp'

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
      <footer className="border-t border-border px-5 py-4 text-center">
        <p className="t-muted text-[12px]">
          HearthShelf is free software under{' '}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            AGPL-3.0
          </a>
          .{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            Source
          </a>
          .
        </p>
      </footer>
    </div>
  )
}
