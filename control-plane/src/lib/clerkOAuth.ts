/**
 * Clerk OAuth-application management.
 *
 * Hosted sign-in is now HS-owned: a paired box mints a per-user ABS token on
 * demand from a control-plane grant (no Clerk OAuth client, no ABS OIDC). The only
 * remaining use is revoking a Clerk OAuth client that was created by the OLD
 * per-server-OIDC code, when such a server deregisters - so we keep just the
 * delete. (New servers never get a client; this is cleanup for legacy ones.)
 */
import type { Env } from '../types'
import { ClerkApiError } from './clerkApi'

const CLERK_API = 'https://api.clerk.com/v1'

function authHeaders(env: Env): HeadersInit {
  if (!env.CLERK_SECRET_KEY) throw new ClerkApiError(0, 'CLERK_SECRET_KEY not configured')
  return {
    Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Delete (revoke) a server's OAuth client. Idempotent: a 404 means it's already
 * gone, which is fine for unlink. Only legacy servers (paired under the old
 * per-server-OIDC code) still have a client to revoke.
 */
export async function deleteOAuthClient(env: Env, appId: string): Promise<void> {
  const res = await fetch(`${CLERK_API}/oauth_applications/${encodeURIComponent(appId)}`, {
    method: 'DELETE',
    headers: authHeaders(env),
  })
  if (res.ok || res.status === 404) return
  const detail = await res.text().catch(() => '')
  throw new ClerkApiError(res.status, detail.slice(0, 300))
}
