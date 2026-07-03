/**
 * Release info for the SPA's update prompts.
 *
 *   GET /releases/latest   the newest HearthShelf version + how loudly to nag
 *
 * Public (no auth): it's the same information anyone can read off the project's
 * GitHub Releases page, just cached so the SPA gets it in one fast call. The box
 * reports its OWN version via POST /servers/version (server_secret authed, in
 * routes/servers.ts); the SPA compares the two.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getLatestReleaseFresh, toDTO } from '../lib/releases'

export const releases = new Hono<{ Bindings: Env }>()

releases.get('/releases/latest', async (c) => {
  const row = await getLatestReleaseFresh(c.env)
  const dto = toDTO(row)
  if (!dto) return c.json({ release: null }, 200)
  return c.json({ release: dto })
})
