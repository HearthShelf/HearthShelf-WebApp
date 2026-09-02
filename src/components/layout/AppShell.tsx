import { useEffect } from 'react'
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
import { useClerkAvatarSync } from '@/hooks/useClerkAvatarSync'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettingsStore } from '@/store/settingsStore'
import { useNavCollapsed } from '@/hooks/useNavCollapsed'
import { useCarMode } from '@/hooks/useCarMode'
import { useCarScale } from '@/hooks/useCarScale'
import { useVisualViewportSize } from '@/hooks/useVisualViewportSize'
import { useCarFaded } from '@/hooks/useCarFaded'
import { SharedDevicePrompt } from '@/components/account/SharedDevicePrompt'
import { ServerHealthWatcher } from '@/components/hosted/ServerHealthWatcher'
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
  //
  // /connect is immersive for a different reason: it is a consent screen an app
  // sent the user to, usually in a small popup window. Library navigation around
  // it is noise at best - and at worst it invites the user to wander off
  // mid-authorization, leaving the app polling a code they never approved.
  const immersive =
    pathname === '/player' || pathname.startsWith('/reader/') || pathname === '/connect'
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
  // User can hide the docked mini player; the full player stays reachable from
  // the player nav / a book's Play button.
  const hideMiniPlayer = useSettingsStore((s) => s.hideMiniPlayer)

  // Car UI scale: shrinks the app when the browser's pixel ratio inflates it
  // (see useCarScale). Applied here rather than on the player, because a car
  // screen renders Library, Settings and everything else too large as well.
  //
  // `zoom` on the document root, not a transform on a wrapper: zoom resizes the
  // CSS pixel itself, so layout measurements and pointer coordinates stay in one
  // coordinate space, and the root is the only target that fixed-position and
  // portalled UI cannot escape. Gated on carMode (any route), not carShell.
  const carScale = useCarScale()
  // Live viewport, needed because zoom breaks vh/vw (below).
  const vv = useVisualViewportSize()
  useEffect(() => {
    if (!carMode || carScale === 1) return
    const root = document.documentElement
    root.style.zoom = String(carScale)
    // Chromium multiplies lengths in a zoomed subtree by the zoom factor but
    // resolves vh/vw against the UNZOOMED viewport, so `height: 100vh` paints
    // at 65% of the screen on a Tesla and every full-height screen ends up
    // short a band at the bottom - as if a keyboard were parked there. The
    // stylesheet writes viewport lengths as `calc(var(--vh) * N)`; publishing
    // 1% of the real viewport, divided back out of the zoom, restores them.
    // visualViewport is the right source: it also tracks the Tesla browser's
    // transient banner and any on-screen keyboard, so the units stay honest.
    if (vv.height > 0) {
      root.style.setProperty('--vh', `${vv.height / carScale / 100}px`)
      root.style.setProperty('--dvh', `${vv.height / carScale / 100}px`)
    }
    if (vv.width > 0) root.style.setProperty('--vw', `${vv.width / carScale / 100}px`)
    return () => {
      root.style.zoom = ''
      root.style.removeProperty('--vh')
      root.style.removeProperty('--dvh')
      root.style.removeProperty('--vw')
    }
  }, [carMode, carScale, vv.width, vv.height])

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
  // Keep the connected server's copy of our Clerk photo current, so every
  // in-app avatar (which reads from the server, never Clerk directly) has
  // something to show without requiring a visit to Settings first.
  useClerkAvatarSync()

  return (
    <div
      className={
        'app' +
        (isMobile ? ' has-mobile-nav' : '') +
        (navCollapsed && !isMobile ? ' nav-collapsed' : '') +
        // car-mode: active on ANY route (drives the large-touch nav tiles + the
        // settings reskin). car-shell: the player-only whole-screen takeover
        // (grid column removed, sidebar overlays + fades).
        (carMode ? ' car-mode' : '') +
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
      {!carShell && !hideMiniPlayer && <MiniPlayer />}
      {/* MobileNav (bottom tab bar + "More" drawer) lives at the .app level, a
          sibling of the mini-player - NOT inside .main - so its drawer can layer
          ABOVE the mini-player. Nested in .main it was trapped in .main's lower
          stacking context and rendered under the playbar. */}
      {isMobile && !immersive && <MobileNav />}
      <SharedDevicePrompt />
      <ServerHealthWatcher />
    </div>
  )
}
