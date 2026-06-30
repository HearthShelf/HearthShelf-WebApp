import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { AppBar } from '@/components/layout/AppBar'
import { MobileNav } from '@/components/layout/MobileNav'
import { MiniPlayer } from '@/player/MiniPlayer'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'
import { useApplySettings } from '@/hooks/useApplySettings'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useNavCollapsed } from '@/hooks/useNavCollapsed'

/**
 * Persistent app frame (design: .app grid + cover-glow bloom), ported from the
 * self-hosted shell so the hosted front door looks and feels the same.
 *
 * The mini-player sits outside the routed Outlet so playback survives navigation.
 * The shell also owns the single connection to the active server - mounting it
 * here means "being in the app" auto-connects, and switching servers in the
 * AppBar transparently reconnects.
 */
export function AppShell() {
  const { pathname } = useLocation()
  // The full-screen player and the ebook reader are immersive: no app bar,
  // no bottom nav.
  const immersive = pathname === '/player' || pathname.startsWith('/reader/')
  const isMobile = useIsMobile()
  // Icon-rail toggle - only meaningful on desktop, where the sidebar is shown.
  const navCollapsed = useNavCollapsed()

  // Drive the connection to the active server for the whole shell.
  useConnectActiveServer()
  // Apply appearance settings (theme via data-theme, accent CSS vars) globally.
  useApplySettings()

  return (
    <div
      className={
        'app' +
        (isMobile ? ' has-mobile-nav' : '') +
        (navCollapsed && !isMobile ? ' nav-collapsed' : '')
      }
    >
      <div className="app-glow" />
      <Sidebar />
      <div className="main">
        {!immersive && !isMobile && <AppBar />}
        <div className="content">
          <Outlet />
        </div>
      </div>
      <MiniPlayer />
      {/* MobileNav (bottom tab bar + "More" drawer) lives at the .app level, a
          sibling of the mini-player - NOT inside .main - so its drawer can layer
          ABOVE the mini-player. Nested in .main it was trapped in .main's lower
          stacking context and rendered under the playbar. */}
      {isMobile && !immersive && <MobileNav />}
    </div>
  )
}
