/**
 * Server registry + grant minting.
 *
 * User-facing (Clerk-authenticated), called by the SPA:
 *   GET    /servers              - list this user's linked servers
 *   POST   /servers/:id/grant    - mint a short-TTL grant for one server
 *   DELETE /servers/:id          - unlink a server from this user
 *
 * Server-to-server (HS authenticates with its server secret), optional path:
 *   POST   /servers/grant        - reserved for a future server-pull model;
 *                                  the default flow is the SPA minting grants
 *                                  it then hands to the browser/HS. Kept as a
 *                                  documented stub so the URL we advertise at
 *                                  pairing time resolves.
 */
import { Hono, type Context } from 'hono'
import type { Env, LinkedServerDTO } from '../types'
import { bearer, verifyClerk, AuthError, type ClerkIdentity } from '../lib/clerk'
import { listLinksForUser, getLink, deleteLink, getServer } from '../lib/db'
import { mintGrant } from '../lib/signing'

export const servers = new Hono<{ Bindings: Env }>()

/** Resolve the Clerk identity, or null if the request is not authenticated. */
async function requireUser(c: Context<{ Bindings: Env }>): Promise<ClerkIdentity | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null
  try {
    return await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }
}

servers.get('/servers', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const links = await listLinksForUser(c.env, user.userId)
  const out: LinkedServerDTO[] = links.map((l) => ({
    id: l.server_id,
    name: l.display_name || l.server_name || l.public_url,
    url: l.public_url,
    role: l.role,
  }))
  return c.json({ servers: out })
})

servers.post('/servers/:id/grant', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.emailVerified) return c.json({ error: 'email_unverified' }, 403)

  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link) return c.json({ error: 'not_linked' }, 404)
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)

  const token = await mintGrant(c.env, {
    clerkUserId: user.userId,
    serverId,
    serverUrl: server.public_url,
    email: link.email,
    username: user.username,
    role: link.role,
  })
  return c.json({
    grant: token,
    server: { id: serverId, url: server.public_url },
    expires_in: Number(c.env.GRANT_TTL_SECONDS || '300'),
  })
})

servers.delete('/servers/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  await deleteLink(c.env, user.userId, c.req.param('id'))
  return c.json({ ok: true })
})

// Documented stub for the advertised grant_url. The shipping design mints
// grants via the user-authenticated /servers/:id/grant above and the client
// carries the grant to HS - the control plane is never in the data path. This
// endpoint exists so the URL we hand HS at pairing time returns a clear 501
// rather than a 404 if anything calls it.
servers.post('/servers/grant', (c) =>
  c.json(
    { error: 'not_implemented', detail: 'use POST /servers/:id/grant (user-authenticated)' },
    501
  )
)
