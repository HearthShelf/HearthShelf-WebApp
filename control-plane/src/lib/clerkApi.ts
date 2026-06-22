/**
 * Clerk Backend API client (the part that needs CLERK_SECRET_KEY).
 *
 * Used only for server-side Clerk operations - right now, creating invitations.
 * Token verification does NOT go through here; that's offline via JWKS (clerk.ts).
 */
import type { Env } from '../types'

const CLERK_API = 'https://api.clerk.com/v1'

export interface CreatedInvitation {
  id: string
}

/**
 * Create a Clerk invitation: Clerk emails the address a sign-up link that
 * lands on `redirectUrl`. We stash server_id + role in public_metadata so the
 * intent survives into the user's profile as a backup to our pending_invites
 * row. Returns the Clerk invitation id (for later revoke), or throws.
 */
export async function createClerkInvitation(
  env: Env,
  params: { email: string; redirectUrl: string; serverId: string; role: 'admin' | 'user' }
): Promise<CreatedInvitation> {
  // Treat a missing key as a (non-fatal) ClerkApiError so callers record the
  // pending invite anyway - the invitee still links on their next sign-in, they
  // just don't get the email until the key is configured.
  if (!env.CLERK_SECRET_KEY) throw new ClerkApiError(0, 'CLERK_SECRET_KEY not configured')

  const res = await fetch(`${CLERK_API}/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: params.email,
      redirect_url: params.redirectUrl,
      public_metadata: { hs_server_id: params.serverId, hs_role: params.role },
      // Skip Clerk's duplicate check failing the call if they already have an
      // account - we still want a pending_invite recorded so the link forms on
      // their next sign-in.
      notify: true,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Clerk returns 422 "duplicate_invitation" / already a member - surface a
    // clean signal the caller can treat as non-fatal.
    throw new ClerkApiError(res.status, detail.slice(0, 300))
  }
  const data = (await res.json()) as { id: string }
  return { id: data.id }
}

export class ClerkApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
