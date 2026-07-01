import { type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'
import { WebAppMediaUIProvider } from '@/components/shared/WebAppMediaUI'
import { Button } from '@/components/ui/Button'

/**
 * Mounts the shared MediaUI provider for the active server, once, around the
 * whole content area. Every browse/detail page underneath reads cover URLs,
 * item navigation, and playback through this - none of them touch a server id in
 * the URL.
 *
 * Handles the three pre-library states centrally so individual pages don't each
 * reimplement them: no server linked, connecting, and connect failure.
 */
export function ActiveServerMediaUI({ children }: { children: ReactNode }) {
  const { target, server, servers, isLoading } = useActiveServer()
  const { state, error, connect, connected } = useConnectActiveServer()

  if (isLoading) {
    return <CenterNote spinner>Loading your library...</CenterNote>
  }

  if (servers.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="t-h2">No server linked yet</p>
        <p className="t-muted mx-auto mt-2 max-w-sm text-[13px]">
          Link your HearthShelf server with the pairing code from its setup screen to reach your
          library from anywhere.
        </p>
        <div className="mt-5">
          <Button onClick={() => (window.location.href = '/account')}>Link a server</Button>
        </div>
      </div>
    )
  }

  if (!target) {
    return <CenterNote spinner>Selecting your server...</CenterNote>
  }

  if (!connected) {
    if (state === 'error') {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="t-h2">Couldn&apos;t reach {server?.name ?? 'your server'}</p>
          <p className="t-muted mx-auto mt-2 max-w-sm text-[13px]">
            {error?.includes('not_paired')
              ? "This server hasn't finished connecting to HearthShelf yet."
              : 'We could not sign you in to this server. Please try again.'}
          </p>
          <div className="mt-5">
            <Button onClick={connect}>Try again</Button>
          </div>
        </div>
      )
    }
    return <CenterNote spinner>Connecting to {server?.name ?? 'your library'}...</CenterNote>
  }

  return <WebAppMediaUIProvider target={target}>{children}</WebAppMediaUIProvider>
}

function CenterNote({ children, spinner }: { children: ReactNode; spinner?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
      {spinner && <Loader2 className="animate-spin" size={18} />}
      <span className="t-body">{children}</span>
    </div>
  )
}
