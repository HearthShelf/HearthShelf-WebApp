import { createBrowserRouter, Navigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ActiveServerMediaUI } from '@/components/shared/ActiveServerMediaUI'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { ItemDetailPage } from '@/pages/ItemDetailPage'
import { AuthorDetailPage } from '@/pages/AuthorDetailPage'
import { SeriesDetailPage } from '@/pages/SeriesDetailPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { PlaylistsPage } from '@/pages/PlaylistsPage'
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage'
import { NarratorsPage } from '@/pages/NarratorsPage'
import { PodcastDetailPage } from '@/pages/PodcastDetailPage'
import { PodcastLatestPage } from '@/pages/PodcastLatestPage'
import { PodcastSearchPage } from '@/pages/PodcastSearchPage'
import { PodcastQueuePage } from '@/pages/PodcastQueuePage'
import { SearchPage } from '@/pages/SearchPage'
import { UploadPage } from '@/pages/UploadPage'
import { RequestsPage } from '@/pages/RequestsPage'
import { DiscoverPage } from '@/pages/DiscoverPage'
import { QuestGiverPage } from '@/pages/QuestGiverPage'
import { StatsPage } from '@/pages/StatsPage'
import { UserProfilePage } from '@/pages/UserProfilePage'
import { FinishedBooksPage } from '@/pages/FinishedBooksPage'
import { UpcomingPage } from '@/pages/UpcomingPage'
import { UpcomingDetailPage } from '@/pages/UpcomingDetailPage'
import { ClubRoomPage } from '@/pages/ClubRoomPage'
import { SessionsPage } from '@/pages/SessionsPage'
import { PlayerPage } from '@/pages/PlayerPage'
import { ReaderPage } from '@/pages/ReaderPage'
import { AccountPage, AccountIndexRedirect } from '@/pages/AccountPage'
import { InvitePage } from '@/pages/InvitePage'
import { ConnectBoxPage } from '@/pages/ConnectBoxPage'
import { ConnectAppPage } from '@/pages/ConnectAppPage'
import { AppStorePage } from '@/pages/AppStorePage'
import { ConnectAiPage } from '@/pages/ConnectAiPage'
import { InfraLogsPage } from '@/pages/InfraLogsPage'
import { ConfigShell, ConfigIndexRedirect } from '@/pages/config/ConfigShell'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import { AdminServersPage } from '@/pages/admin/AdminServersPage'
import { AdminAdminsPage } from '@/pages/admin/AdminAdminsPage'
import { AdminAppsPage } from '@/pages/admin/AdminAppsPage'
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { ErrorPage } from '@/pages/ErrorPage'
import { CarPlayerHarness } from '@/pages/dev/CarPlayerHarness'
import { RecentListensHarness } from '@/pages/dev/RecentListensHarness'
import { UserProfileHarness } from '@/pages/dev/UserProfileHarness'
import { LogViewHarness } from '@/pages/dev/LogViewHarness'
import { PinEntryHarness } from '@/pages/dev/PinEntryHarness'
import { MentionHarness } from '@/pages/dev/MentionHarness'
import { SwitcherHarness } from '@/pages/dev/SwitcherHarness'
import { SharedDevicePromptHarness } from '@/pages/dev/SharedDevicePromptHarness'
import { SettingsCarHarness } from '@/pages/dev/SettingsCarHarness'
import { SettingsSearchHarness } from '@/pages/dev/SettingsSearchHarness'
import { BulkPermissionsHarness } from '@/pages/dev/BulkPermissionsHarness'
import { ConnectAiHarness } from '@/pages/dev/ConnectAiHarness'
import { AiConnectionHarness } from '@/pages/dev/AiConnectionHarness'
import { RequireAuth } from '@/auth/RequireAuth'
import { PlayerProvider } from '@/player/PlayerProvider'

// The library shell: the persistent frame + the active-server connection +
// the shared MediaUI provider. Every library/browse page renders inside this,
// so none of them carry a server id in the URL - the active server is ambient.
function withShell(element: React.ReactNode) {
  return <ActiveServerMediaUI>{element}</ActiveServerMediaUI>
}

// /pair?code=XXXX-XXXX -> /account/servers?code=XXXX-XXXX. A bare <Navigate>
// would drop the query string; this preserves it so AccountPage can read it.
function PairRedirect() {
  const [params] = useSearchParams()
  const code = params.get('code')
  return (
    <Navigate
      to={code ? `/account/servers?code=${encodeURIComponent(code)}` : '/account/servers'}
      replace
    />
  )
}

export const router = createBrowserRouter([
  // Public account routes (embedded Clerk components). Splat paths so Clerk can
  // own its multi-step sub-routes (email verification, OAuth callback, etc.).
  { path: '/sign-in/*', element: <SignInPage /> },
  { path: '/sign-up/*', element: <SignUpPage /> },

  // DEV-ONLY: car-player visual harness (no auth). Stripped from prod builds.
  ...(import.meta.env.DEV
    ? [
        { path: '/dev/car', element: <CarPlayerHarness /> },
        { path: '/dev/recent', element: <RecentListensHarness /> },
        { path: '/dev/profile', element: <UserProfileHarness /> },
        { path: '/dev/logs', element: <LogViewHarness /> },
        { path: '/dev/pin', element: <PinEntryHarness /> },
        { path: '/dev/mention', element: <MentionHarness /> },
        { path: '/dev/switcher', element: <SwitcherHarness /> },
        { path: '/dev/shared-prompt', element: <SharedDevicePromptHarness /> },
        { path: '/dev/settings-car', element: <SettingsCarHarness /> },
        { path: '/dev/settings-search/*', element: <SettingsSearchHarness /> },
        { path: '/dev/bulk-perms', element: <BulkPermissionsHarness /> },
        { path: '/dev/connect-ai', element: <ConnectAiHarness /> },
        { path: '/dev/ai-settings', element: <AiConnectionHarness /> },
      ]
    : []),

  // Everything else requires sign-in.
  {
    element: (
      <RequireAuth>
        <PlayerProvider>
          <AppShell />
        </PlayerProvider>
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      // Library surfaces - all scoped to the ambient active server.
      { path: '/', element: withShell(<HomePage />) },
      { path: '/library', element: withShell(<LibraryPage />) },
      { path: '/book/:itemId', element: withShell(<ItemDetailPage />) },
      { path: '/author/:authorId', element: withShell(<AuthorDetailPage />) },
      { path: '/series/:seriesId', element: withShell(<SeriesDetailPage />) },
      { path: '/collections', element: withShell(<CollectionsPage />) },
      { path: '/collections/:collectionId', element: withShell(<CollectionDetailPage />) },
      { path: '/playlists', element: withShell(<PlaylistsPage />) },
      { path: '/playlists/:playlistId', element: withShell(<PlaylistDetailPage />) },
      { path: '/narrators', element: withShell(<NarratorsPage />) },
      { path: '/podcast/:podcastId', element: withShell(<PodcastDetailPage />) },
      { path: '/podcasts/latest', element: withShell(<PodcastLatestPage />) },
      { path: '/podcasts/add', element: withShell(<PodcastSearchPage />) },
      { path: '/podcasts/queue', element: withShell(<PodcastQueuePage />) },
      { path: '/search', element: withShell(<SearchPage />) },
      { path: '/upload', element: withShell(<UploadPage />) },

      // QuestGiver + Discover + Requests. All self-gate inside the page on the
      // active server's /hs/* feature flag and redirect home when it's off.
      // QuestGiver and Discover share the /hs/questgiver/config flag.
      { path: '/questgiver', element: withShell(<QuestGiverPage />) },
      { path: '/discover', element: withShell(<DiscoverPage />) },
      { path: '/requests', element: withShell(<RequestsPage />) },

      { path: '/stats', element: withShell(<StatsPage />) },
      { path: '/user/:userId', element: withShell(<UserProfilePage />) },
      { path: '/finished', element: withShell(<FinishedBooksPage />) },
      { path: '/upcoming', element: withShell(<UpcomingPage />) },
      { path: '/upcoming/:asin', element: withShell(<UpcomingDetailPage />) },
      { path: '/clubs', element: withShell(<ClubRoomPage />) },
      { path: '/club/:clubId', element: withShell(<ClubRoomPage />) },
      { path: '/sessions', element: withShell(<SessionsPage />) },
      { path: '/player', element: withShell(<PlayerPage />) },
      { path: '/reader/:itemId', element: withShell(<ReaderPage />) },

      // Server admin (the /config panel). Acts on the ambient active server, so
      // it renders inside withShell (needs the connected target). Gated to ABS
      // server-admins inside ConfigShell. Bare /config drills down on mobile and
      // redirects to the default section on desktop; the user-detail sub-route
      // keeps the Users nav item lit.
      { path: '/config', element: withShell(<ConfigIndexRedirect />) },
      { path: '/config/users/:userId', element: withShell(<ConfigShell />) },
      { path: '/config/:section', element: withShell(<ConfigShell />) },

      // Account (Clerk profile + My Servers + plan). No active-server gate - it
      // manages servers, so it must render even with zero linked. Bare /account
      // drills down on mobile and redirects to the default section on desktop.
      { path: '/account', element: <AccountIndexRedirect /> },
      { path: '/account/:section', element: <AccountPage /> },

      // Deep-link entry points. These resolve a server id from the query, set it
      // active, and bounce to the clean library - the UUID never sticks in the URL.
      // /pair keeps the ?code= query string alive on its way to /account/servers,
      // which reads it and opens the Link-a-server dialog pre-filled.
      { path: '/pair', element: <PairRedirect /> },
      { path: '/invite', element: <InvitePage /> },
      { path: '/connect-box', element: <ConnectBoxPage /> },
      // Third-party app consent: an app showed the user a code and is polling.
      { path: '/connect', element: <ConnectAppPage /> },
      // The app store. Lists reviewed hosted services only - self-hosted apps
      // are connected from inside the app itself (see the page for why).
      { path: '/apps', element: <AppStorePage /> },
      // Sign-in bounce for the MCP server's OAuth flow: hands the MCP Worker a
      // Clerk session token so an AI client can be connected in one click.
      { path: '/connect-ai', element: <ConnectAiPage /> },

      // Platform-admin area (gated to the platform_admins roster by the CP).
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminServersPage /> },
          { path: 'servers', element: <AdminServersPage /> },
          { path: 'admins', element: <AdminAdminsPage /> },
          { path: 'apps', element: <AdminAppsPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
          { path: 'logs', element: <InfraLogsPage /> },
        ],
      },
      { path: '/infra-logs', element: <Navigate to="/admin/logs" replace /> },
      // Old server-scoped deep links -> clean equivalents.
      { path: '/server/:serverId', element: <Navigate to="/" replace /> },
    ],
  },

  { path: '*', element: <ErrorPage /> },
])
