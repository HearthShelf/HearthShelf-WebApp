/**
 * Control-plane client.
 *
 * The MCP server reaches a user's box exactly the way the SPA does
 * (src/lib/connectServer.ts): ask the control plane which servers this identity
 * is linked to, mint a short-TTL grant for one, and redeem that grant at the
 * box's own /hs/hosted/connect for a per-user ABS token.
 *
 * The control plane is never in the data path - once we hold an ABS token we
 * talk straight to the box. See ../../ARCHITECTURE.md.
 */
import type { Env, LinkedServer, McpProps } from '../types'

/**
 * The user's Clerk session token was rejected by the control plane. This is the
 * EXPECTED failure once a captured session token ages out (see McpProps.
 * clerkToken), so callers turn it into a "reconnect HearthShelf" message rather
 * than leaking a raw 401 into a chat transcript.
 */
export class CpAuthError extends Error {
  constructor(message = 'control_plane_unauthorized') {
    super(message)
  }
}

/** A control-plane call failed for a non-auth reason (down, 5xx, network). */
export class CpError extends Error {}

async function cpFetch<T>(env: Env, props: McpProps, path: string, init?: RequestInit): Promise<T> {
  const base = env.CONTROL_PLANE_URL.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${props.clerkToken}`,
        Accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch (err) {
    throw new CpError(`control_plane_unreachable: ${(err as Error).message}`)
  }
  if (res.status === 401 || res.status === 403) throw new CpAuthError()
  if (!res.ok) throw new CpError(`control_plane_${res.status}`)
  return (await res.json()) as T
}

/** List the servers this Clerk identity is linked to. */
export async function listServers(env: Env, props: McpProps): Promise<LinkedServer[]> {
  const data = await cpFetch<{ servers?: LinkedServer[] }>(env, props, '/servers')
  return data.servers ?? []
}

/**
 * Mint a short-TTL grant for one server and redeem it at that box for a
 * per-user ABS token. Mirrors src/lib/connectServer.ts.
 *
 * Returns the ABS token plus the origin it is valid for - a token is scoped to
 * one box, so callers must keep the pair together.
 */
export async function connectToServer(
  env: Env,
  props: McpProps,
  serverId: string,
): Promise<{ token: string; serverUrl: string }> {
  const grantRes = await cpFetch<{ grant: string; server: { id: string; url: string } }>(
    env,
    props,
    `/servers/${encodeURIComponent(serverId)}/grant`,
    { method: 'POST' },
  )

  const origin = grantRes.server.url.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${origin}/hs/hosted/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant: grantRes.grant }),
    })
  } catch (err) {
    throw new CpError(`server_unreachable: ${(err as Error).message}`)
  }
  if (!res.ok) {
    let detail = String(res.status)
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error || detail
    } catch {
      // keep the status code
    }
    throw new CpError(`connect_failed: ${detail}`)
  }
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new CpError('connect_failed: no_token')
  return { token: data.token, serverUrl: origin }
}
