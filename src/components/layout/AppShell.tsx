import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { AppBar } from '@/components/layout/AppBar'
import { MobileNav } from '@/components/layout/MobileNav'
import { MiniPlayer } from '@/player/MiniPlayer'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'
import { useApplySettings } from '@/hooks/useApplySettings'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { useQueueSync } from '@/hooks/useQueueSync'
import { useNotePops } from '@/hooks/useNotePops'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useNavCollapsed } from '@/hooks/useNavCollapsed'
import { useCarMode } from '@/hooks/useCarMode'
import { useCarFaded } from '@/hooks/useCarFaded'
import { SharedDevicePrompt } from '@/components/account/SharedDevicePrompt'
import { UpdateBanner } from '@/components/common/UpdateBanner'

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
  // Car mode on the player route owns the whole screen: the sidebar fades out
  // (in step with the rest of the car player's chrome) so the big-touch
  // player isn't sharing space with the nav rail while idle, but reappears on
  // the same wake gesture as everything else - it stays mounted rather than
  // being hard-hidden so that "tap to bring it back" feels consistent.
  const carMode = useCarMode()
  const carShell = carMode && pathname === '/player'
  const carFaded = useCarFaded()

  // Drive the connection to the active server for the whole shell.
  useConnectActiveServer()
  // Apply appearance settings (theme via data-theme, accent CSS vars) globally.
  useApplySettings()
  // Sync settings per-key with the active server so they follow the user across
  // devices.
  useSettingsSync()
  useQueueSync()
  // Toast when playback crosses a club note (deep-links into the club room).
  useNotePops()

  return (
    <div
      className={
        'app' +
        (isMobile ? ' has-mobile-nav' : '') +
        (navCollapsed && !isMobile ? ' nav-collapsed' : '') +
        (carShell ? ' car-shell' : '') +
        (carShell && carFaded ? ' car-shell-faded' : '')
      }
    >
      <div className="app-glow" />
      {/* In car mode the sidebar overlays the player (car-shell takes its grid
          column away) instead of unmounting, so it can fade with the rest of
          the chrome and reappear on the same wake gesture. */}
      <Sidebar />
      <div className="main">
        {!immersive && !isMobile && <AppBar />}
        <div className="content">
          {!immersive && <UpdateBanner />}
          <Outlet />
        </div>
      </div>
      {!carShell && <MiniPlayer />}
      {/* MobileNav (bottom tab bar + "More" drawer) lives at the .app level, a
          sibling of the mini-player - NOT inside .main - so its drawer can layer
          ABOVE the mini-player. Nested in .main it was trapped in .main's lower
          stacking context and rendered under the playbar. */}
      {isMobile && !immersive && <MobileNav />}
      <SharedDevicePrompt />
    </div>
  )
}
