/**
 * Public discovery endpoints. No auth.
 *
 * /.well-known/jwks.json - the control plane's public signing keys. HS servers
 * fetch this to verify grant assertions offline. The set HS pins at pairing
 * time is bootstrapped from here, and HS refreshes from here to follow key
 * rotation.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { jwks } from '../lib/signing'

export const wellKnown = new Hono<{ Bindings: Env }>()

wellKnown.get('/.well-known/jwks.json', async (c) => {
  const set = await jwks(c.env)
  // Cacheable: keys rotate rarely. HS also keeps its own cache.
  c.header('Cache-Control', 'public, max-age=3600')
  return c.json(set)
})
