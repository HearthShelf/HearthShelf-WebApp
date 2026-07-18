import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getHostedStatus,
  startPairing,
  inviteFromServer,
  getHsDirectState,
  checkPort,
  pollPairStatus,
  disconnectHosted,
  getServiceHealth,
  resetServiceCredential,
  overrideServiceCredential,
  hostedKeys,
  HostedError,
  type PairResult,
  type PortCheckResult,
} from '@/api/absHosted'
import { ServiceAccountHealth } from '@/components/hosted/ServiceAccountHealth'
import { ConnectivityDiagram } from '@/components/hosted/ConnectivityDiagram'
import { friendlyError } from '@/lib/errorMessages'

// "12:34" style mm:ss left until the pairing code expires, or null once gone.
function timeLeft(expiresAt: string | number, nowMs: number): string | null {
  // The control plane may report expiry as epoch ms or an ISO-8601 string.
  const epoch = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt)
  if (Number.isNaN(epoch)) return null
  const ms = epoch - nowMs
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Short help for forwarding a port when the box isn't reachable from outside.
function ReachabilityHelp({ port }: { port: number }) {
  return (
    <div className="banner info" style={{ marginTop: 'var(--s3)' }}>
      <Icon name="info" />
      <div>
        Forward port <strong>{port}</strong> on your router to this machine so people you invite can
        reach it from outside your network. Look for "port forwarding" in your router's settings.
      </div>
    </div>
  )
}

// HearthShelf Connect. Pairs this server to app.hearthshelf.com, manages its
// public address + reachability, and invites people by email. These drive the
// server's own /hs/hosted/* backend through the connection you're already using.
export function ConfigHosted() {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target, server } = useActiveServer()
  const serverName = server?.name || 'This server'

  const { data: status, isLoading } = useQuery({
    queryKey: hostedKeys.status(target?.serverId ?? ''),
    queryFn: () => getHostedStatus(target!),
    enabled: Boolean(target),
    staleTime: 15 * 1000,
    retry: false,
  })

  const [pairResult, setPairResult] = useState<PairResult | null>(null)
  const [claimed, setClaimed] = useState(false)

  // Tick once a second so the code's expiry countdown stays live.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!pairResult) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [pairResult])

  const remaining = pairResult ? timeLeft(pairResult.expires_at, nowMs) : null

  function copyCode() {
    if (!pairResult) return
    void navigator.clipboard.writeText(pairResult.code)
    show('Code copied')
  }
  function openControlPlane() {
    if (!pairResult) return
    const base = (pairResult.control_plane || '').replace(/\/$/, '')
    if (!base) return
    window.open(`${base}/pair?code=${encodeURIComponent(pairResult.code)}`, '_blank', 'noopener')
  }

  const pair = useMutation({
    mutationFn: () => startPairing(target!),
    onSuccess: (r) => {
      setClaimed(false)
      setPairResult(r)
      qc.invalidateQueries({ queryKey: hostedKeys.status(target!.serverId) })
      show('Pairing started - enter the code on app.hearthshelf.com')
    },
    onError: (e: Error) => show(friendlyError(e, 'Could not start connecting')),
  })

  const disconnect = useMutation({
    mutationFn: () => disconnectHosted(target!),
    onSuccess: () => {
      setPairResult(null)
      setClaimed(false)
      qc.invalidateQueries({ queryKey: hostedKeys.status(target!.serverId) })
      qc.invalidateQueries({ queryKey: hostedKeys.hsdirect(target!.serverId) })
      show('Disconnected from app.hearthshelf.com')
    },
    onError: (e: Error) => show(friendlyError(e, 'Could not disconnect')),
  })

  // hs.direct provisioning: the assigned *.hs.direct address + cert state.
  const { data: hsDirect } = useQuery({
    queryKey: hostedKeys.hsdirect(target?.serverId ?? ''),
    queryFn: () => getHsDirectState(target!),
    enabled: Boolean(target) && Boolean(status?.paired),
    staleTime: 10 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'pending' ? 4000 : false),
  })

  // Port reachability via the hs.direct VPS connecting back to this box's IP.
  // The check is proxied through the hs.direct broker. Two failure modes are very
  // different and must not be conflated:
  //   - the box is unreachable (open:false) -> the user needs to forward a port.
  //   - the BROKER is down (broker_unreachable / probe failed) -> we simply can't
  //     run the check; this says NOTHING about the box, which is provably
  //     connected (you're administering it through app.hearthshelf.com). Never
  //     imply the server is down in this case.
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null)
  // Set when the broker itself couldn't be reached, so the check is inconclusive.
  const [checkUnavailable, setCheckUnavailable] = useState(false)
  const testPort = useMutation({
    mutationFn: (_source: 'auto' | 'manual') => checkPort(target!),
    onSuccess: (r) => {
      setPortResult(r)
      setCheckUnavailable(false)
    },
    onError: (err, source) => {
      // A broker/infra failure means "check unavailable", not "unreachable".
      const code = err instanceof HostedError ? err.code : ''
      const brokerDown =
        code === 'broker_unreachable' || code === 'probe_failed' || code === 'network'
      if (brokerDown) setCheckUnavailable(true)
      if (source === 'manual') {
        show(
          brokerDown
            ? 'Couldn’t reach the reachability service just now - try again in a moment. This doesn’t affect your server.'
            : 'Could not run the connection check - try again in a moment',
        )
      }
    },
  })

  // Auto-run the connection check ONCE when paired. On failure, retry at most a
  // couple of times with backoff, then stop - a dead broker must not be polled
  // forever (it floods the network log and never succeeds). The manual "Check
  // connection" button is always available to try again on demand.
  const AUTO_RETRY_LIMIT = 2
  const autoAttempts = useRef(0)
  const portChecked = portResult !== null
  useEffect(() => {
    if (!status?.paired) return
    if (portChecked || testPort.isPending) return
    if (testPort.isError) {
      if (autoAttempts.current >= AUTO_RETRY_LIMIT) return // give up quietly
      const retry = setTimeout(() => {
        autoAttempts.current += 1
        testPort.mutate('auto')
      }, 15000)
      return () => clearTimeout(retry)
    }
    autoAttempts.current += 1
    testPort.mutate('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.paired, portChecked, testPort.isPending, testPort.isError])

  // Poll the control plane for the claim while a code is showing.
  useEffect(() => {
    const code = pairResult?.code
    if (!code || claimed || !target) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const s = await pollPairStatus(target, code).catch(() => null)
      if (cancelled) return
      if (s?.claimed) {
        setClaimed(true)
        qc.invalidateQueries({ queryKey: hostedKeys.status(target.serverId) })
        setPairResult(null)
        show('Connected to app.hearthshelf.com')
        return
      }
      if (!s || !s.expired) timer = setTimeout(poll, 4000)
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pairResult?.code, claimed, qc, target, show])

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const invite = useMutation({
    mutationFn: () => inviteFromServer(target!, email.trim(), role),
    onSuccess: (r) => {
      show(`Invited ${r.email} - email sent`)
      setEmail('')
    },
    onError: (e: Error) => show(friendlyError(e, 'Invite failed')),
  })

  if (!target || isLoading || !status) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">HearthShelf Connect</h1>
        </div>
        <LoadingSpinner className="py-12" label="Loading..." />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">HearthShelf Connect</h1>
        <p className="page-sub">
          Connect this server to app.hearthshelf.com so people can reach it from one place, and
          invite people to it by email.
        </p>
      </div>

      <div className="section-head">
        <Icon name="link" />
        <h2>Connection</h2>
      </div>
      <div className="cfg-card">
        <div className="set-row">
          <div className="sr-meta">
            <div className="sr-t">
              {status.paired ? 'Connected to app.hearthshelf.com' : 'Not connected'}
            </div>
            <div className="sr-d">
              {status.paired
                ? `${serverName} is reachable from the HearthShelf app, and you can invite people by email.`
                : 'Connect this server so you and people you invite can reach it from app.hearthshelf.com.'}
            </div>
          </div>
          {status.paired ? (
            <button
              className="btn btn-danger"
              disabled={disconnect.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Disconnect from app.hearthshelf.com? People you invited will lose access until you reconnect.',
                  )
                )
                  disconnect.mutate()
              }}
            >
              <Icon name="link_off" />
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button className="btn" disabled={pair.isPending} onClick={() => pair.mutate()}>
              <Icon name="add_link" />
              {pair.isPending ? 'Starting…' : 'Connect'}
            </button>
          )}
        </div>

        {status.paired && (
          <div style={{ marginTop: 'var(--s2)' }}>
            <button
              className="btn-sm btn-ghost"
              disabled={pair.isPending}
              onClick={() => pair.mutate()}
            >
              <Icon name="sync" /> {pair.isPending ? 'Starting…' : 'Re-pair (reset the connection)'}
            </button>
          </div>
        )}

        {pairResult && !claimed && (
          <div className="banner info" style={{ marginTop: 'var(--s4)' }}>
            <Icon name="key" />
            <div style={{ width: '100%' }}>
              Enter this code on <strong>app.hearthshelf.com</strong> to finish connecting:
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s3)',
                  flexWrap: 'wrap',
                  marginTop: 6,
                }}
              >
                <span className="t-mono" style={{ fontSize: '1.4rem', letterSpacing: '0.1em' }}>
                  {pairResult.code}
                </span>
                <button className="btn-sm btn-ghost" onClick={copyCode}>
                  <Icon name="content_copy" /> Copy
                </button>
                <button className="btn-sm btn-ghost" onClick={openControlPlane}>
                  <Icon name="open_in_new" /> Open app.hearthshelf.com
                </button>
                <span className="sr-d" style={{ marginLeft: 'auto' }}>
                  {remaining
                    ? `Expires in ${remaining}`
                    : 'Code expired - re-pair to get a new one'}
                </span>
              </div>
              <div
                style={{
                  marginTop: 'var(--s4)',
                  borderTop: '1px solid var(--hairline)',
                  paddingTop: 'var(--s3)',
                }}
              >
                <div className="sr-d">
                  Waiting for you to enter the code - this finishes automatically the moment you do.
                </div>
              </div>
            </div>
          </div>
        )}

        {status.paired && target && (
          <ServiceAccountHealth
            getHealth={() => getServiceHealth(target)}
            onReset={() => resetServiceCredential(target)}
            onOverride={(b) => overrideServiceCredential(target, b)}
            onChanged={() =>
              qc.invalidateQueries({ queryKey: hostedKeys.status(target.serverId) })
            }
          />
        )}

        {/* LAN -> WAN -> Cloud connectivity map, colored from real signals. */}
        {status.paired && (
          <ConnectivityDiagram
            paired={status.paired}
            reachable={portResult ? portResult.open : null}
            port={portResult?.port ?? null}
            certActive={hsDirect?.status === 'active'}
            serverName={serverName}
          />
        )}

        {status.paired && (
          <div className="set-row" style={{ marginTop: 'var(--s4)' }}>
            <div className="sr-meta" style={{ width: '100%' }}>
              <div className="sr-t">Reachable from outside your network?</div>
              {hsDirect?.status === 'active' && (
                <div className="sr-d" style={{ marginBottom: 6 }}>
                  {serverName} has a secure web address set up by HearthShelf. People you invite
                  reach it through the HearthShelf app - there's nothing to copy or share.
                </div>
              )}
              {hsDirect?.status === 'pending' && (
                <div className="sr-d" style={{ marginBottom: 6 }}>
                  Setting up your secure address… you can still test the connection.
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s3)',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  className="btn-sm btn-ghost"
                  disabled={testPort.isPending}
                  onClick={() => testPort.mutate('manual')}
                >
                  <Icon name="travel_explore" />
                  {testPort.isPending ? 'Checking…' : 'Check connection'}
                </button>
                {portResult?.open && (
                  <span className="sr-d" style={{ color: 'var(--primary)' }}>
                    Reachable on port {portResult.port}.
                  </span>
                )}
                {portResult && !portResult.open && (
                  <span className="sr-d" style={{ color: 'var(--warn, #d9a45a)' }}>
                    Not reachable - forward port {portResult.port} on your router to this machine.
                  </span>
                )}
                {!portResult && checkUnavailable && (
                  <span className="sr-d" style={{ color: 'var(--text-muted)' }}>
                    Couldn’t run this check just now - the reachability service didn’t respond. Your
                    server is still connected (you’re managing it here); try the check again in a
                    moment.
                  </span>
                )}
              </div>
              {portResult && !portResult.open && <ReachabilityHelp port={portResult.port} />}
            </div>
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="person_add" />
        <h2>Invite people</h2>
      </div>
      <div className="cfg-card">
        {!status.paired ? (
          <div className="banner info">
            <Icon name="info" />
            Connect this server above before inviting people.
          </div>
        ) : (
          <>
            <div className="field full">
              <label>Email address</label>
              <input
                className="fld"
                type="email"
                placeholder="name@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field full">
              <label>Role</label>
              <select
                className="fld"
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={invite.isPending || !email.trim()}
              onClick={() => invite.mutate()}
              style={{ marginTop: 'var(--s2)' }}
            >
              <Icon name="send" /> {invite.isPending ? 'Sending…' : 'Send invite'}
            </button>
          </>
        )}
      </div>

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </>
  )
}
