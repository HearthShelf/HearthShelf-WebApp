/**
 * Release info for update prompts.
 *
 *   GET /releases/latest   the newest HearthShelf (self-hosted box) version
 *   GET /releases/mobile   the newest HearthShelf-Mobile version + store links
 *
 * Public (no auth): it's the same information anyone can read off the project's
 * GitHub repos, just cached so clients get it in one fast call.
 *
 * /latest: the box reports its OWN version via POST /servers/version
 * (server_secret authed, in routes/servers.ts); the SPA compares the two.
 *
 * /mobile: the iOS app compares its baked version against this on foreground and
 * nags per severity / min_supported (Android uses Play's native in-app updates
 * instead, so it never needs this - the android store URL is served anyway for
 * completeness). The store_urls come from env vars so the iOS link can flip from
 * the TestFlight invite to the App Store page without shipping an app update.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getLatestReleaseFresh, getLatestMobileReleaseFresh, toDTO } from '../lib/releases'

const DEFAULT_IOS_STORE_URL = 'https://testflight.apple.com/join/ehxv65Ms'
const DEFAULT_ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.hearthshelf.mobile'

export const releases = new Hono<{ Bindings: Env }>()

releases.get('/releases/latest', async (c) => {
  const row = await getLatestReleaseFresh(c.env)
  const dto = toDTO(row)
  if (!dto) return c.json({ release: null }, 200)
  return c.json({ release: dto })
})

releases.get('/releases/mobile', async (c) => {
  const row = await getLatestMobileReleaseFresh(c.env)
  const dto = toDTO(row)
  if (!dto) return c.json({ release: null }, 200)
  return c.json({
    release: {
      ...dto,
      store_urls: {
        ios: c.env.MOBILE_IOS_STORE_URL || DEFAULT_IOS_STORE_URL,
        android: c.env.MOBILE_ANDROID_STORE_URL || DEFAULT_ANDROID_STORE_URL,
      },
    },
  })
})
