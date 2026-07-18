import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { getServerRuntime, getServiceHealth, resetServiceCredential } from '@/api/absHosted'
import { ServerHealthAlert } from '@/components/hosted/ServerHealthAlert'

// App-level watcher: for admins of the active server, polls the provisioning-
// credential health and interrupts with a blocking alert when it's BROKEN
// (invited people can't join). Mounted once in AppShell, like SharedDevicePrompt.
// Non-admins, unpaired servers, and healthy servers render nothing.
export function ServerHealthWatcher() {
  const { target, server } = useActiveServer()
  const navigate = useNavigate()
  const [snoozed, setSnoozed] = useState(false)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const isAdmin = me?.type === 'admin' || me?.type === 'root'

  // Only relevant on a paired server (one that provisions invited users).
  const { data: runtime } = useQuery({
    queryKey: ['server-runtime', target?.serverId],
    queryFn: () => getServerRuntime(target!),
    enabled: Boolean(target) && isAdmin,
    staleTime: 60 * 1000,
  })
  const paired = Boolean(runtime?.paired)

  const { data: health } = useQuery({
    queryKey: ['server-health', target?.serverId],
    queryFn: () => getServiceHealth(target!),
    enabled: Boolean(target) && isAdmin && paired,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  if (!isAdmin || !health || health.state !== 'broken' || snoozed || !target) return null

  return (
    <ServerHealthAlert
      health={health}
      serverName={server?.name}
      onReset={() => resetServiceCredential(target)}
      onGoToConnect={() => {
        setSnoozed(true)
        navigate('/config/connect')
      }}
      onGoToLogs={() => {
        setSnoozed(true)
        navigate('/config/logs')
      }}
      onSnooze={() => setSnoozed(true)}
    />
  )
}
