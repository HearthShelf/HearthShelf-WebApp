import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { AppBar } from '@/components/layout/AppBar'
import { MobileNav } from '@/components/layout/MobileNav'
import { MiniPlayer } from '@/player/MiniPlayer'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'
import { useIsMobile } from '@/hooks/useMediaQuery'

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

  // Drive the connection to the active server for the whole shell.
  useConnectActiveServer()

  return (
    <div className={'app' + (isMobile ? ' has-mobile-nav' : '')}>
      <div className="app-glow" />
      <Sidebar />
      <div className="main">
        {!immersive && !isMobile && <AppBar />}
        <div className="content">
          <Outlet />
        </div>
        {isMobile && !immersive && <MobileNav />}
      </div>
      <MiniPlayer />
    </div>
  )
}
