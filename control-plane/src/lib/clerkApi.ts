/**
 * Clerk Backend API client (the part that needs CLERK_SECRET_KEY).
 *
 * Used only for server-side Clerk operations - right now, creating invitations.
 * Token verification does NOT go through here; that's offline via JWKS (clerk.ts).
 */
import type { Env } from '../types'

const CLERK_API = 'https://api.clerk.com/v1'

/*
 * NOTE: there is deliberately no createClerkInvitation here.
 *
 * Invites used to create a Clerk invitation alongside our own. It emailed a
 * /sign-up link that dead-ends for anyone who already has an account, so an
 * invitee's success depended on which of the two emails they happened to open.
 * Removing it lost nothing: Clerk sign-up is open (no restricted mode), so the
 * invitation never gated access, and its public_metadata was written but never
 * read. The HearthShelf invite code in pending_invites is the real mechanism.
 */

/**
 * Mint a single-use Clerk sign-in token for a given user (the account switcher).
 * The token is redeemed on the frontend with the 'ticket' strategy
 * (signIn.create({ strategy: 'ticket', ticket })), which signs the browser in as
 * that user without a password. It needs CLERK_SECRET_KEY, so it can only run
 * here, never in the SPA. Single-use and short-lived - we keep the TTL small
 * because the ticket is redeemed immediately after minting.
 */
export async function createSignInToken(
  env: Env,
  params: { userId: string; expiresInSeconds?: number },
): Promise<{ token: string }> {
  if (!env.CLERK_SECRET_KEY) throw new ClerkApiError(0, 'CLERK_SECRET_KEY not configured')

  const res = await fetch(`${CLERK_API}/sign_in_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      expires_in_seconds: params.expiresInSeconds ?? 60,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new ClerkApiError(res.status, detail.slice(0, 300))
  }
  const data = (await res.json()) as { token: string }
  return { token: data.token }
}

/**
 * Delete a Clerk user's identity outright (the account data-deletion flow).
 * Called only AFTER our own D1/collector data for the user has already been
 * purged - once this succeeds, the user can no longer authenticate, so it must
 * be the last step. Idempotent-ish: Clerk 404s if the user is already gone,
 * which callers should treat as success.
 */
export async function deleteClerkUser(env: Env, userId: string): Promise<void> {
  if (!env.CLERK_SECRET_KEY) throw new ClerkApiError(0, 'CLERK_SECRET_KEY not configured')

  const res = await fetch(`${CLERK_API}/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
  })

  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '')
    throw new ClerkApiError(res.status, detail.slice(0, 300))
  }
}

export class ClerkApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
