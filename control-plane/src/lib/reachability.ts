/**
 * Reachability checks for a server's public URL.
 *
 * The hosted browser at app.hearthshelf.com connects to a server's public origin
 * directly (OIDC bounce + data path), so that origin MUST be a real, CA-valid
 * HTTPS endpoint reachable from the public internet. A bare IP, a plain-HTTP URL,
 * or an unreachable host can never work from the browser - so we reject those at
 * pairing time and surface live status in the picker, rather than letting the
 * OIDC popup fail with a cryptic cert error later. See docs/hosted-oidc-design.md
 * section 7 (reachability), MVP Option A.
 */

export interface UrlValidation {
  ok: boolean
  /** Machine-readable reason when ok === false. */
  reason?: 'not_absolute' | 'not_https' | 'ip_host' | 'bad_host'
  /** The normalized origin (no trailing slash) when ok === true. */
  origin?: string
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Validate that a public URL is usable as a browser-reachable origin:
 * absolute, https, and a real hostname (not a bare IP - a bare IP can't carry a
 * CA-valid cert, so the browser would refuse it). We do not require a specific
 * path; the origin is what matters.
 */
export function validatePublicUrl(raw: string): UrlValidation {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'not_absolute' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' }
  const host = u.hostname
  if (!host) return { ok: false, reason: 'bad_host' }
  // Bare IPv4 or bracketed IPv6 can't have a publicly trusted cert for browsers.
  if (IPV4.test(host) || host.startsWith('[')) return { ok: false, reason: 'ip_host' }
  // A hostname with no dot (e.g. "localhost", a LAN name) won't have a public cert.
  if (!host.includes('.')) return { ok: false, reason: 'bad_host' }
  return { ok: true, origin: u.origin }
}

export type ProbeStatus = 'online' | 'offline'

export interface ProbeResult {
  status: ProbeStatus
  /** HTTP status from the health endpoint when reached. */
  httpStatus?: number
  /** Short detail when offline (timeout, dns, tls, etc.). */
  detail?: string
}

/**
 * Probe a server's public origin for liveness by hitting the unauthenticated
 * health endpoint ABS exposes (nginx forwards `/healthcheck` straight to ABS on
 * every server). A 2xx/3xx means reachable. Times out fast so the picker stays
 * snappy. This runs from the Worker, which is a reasonable proxy for "publicly
 * reachable over valid TLS" - the browser's own connectivity can still differ,
 * but a Worker-side success rules out the common failures (down, no DNS, bad
 * cert, HTTP-only).
 */
export async function probeServer(origin: string, timeoutMs = 4000): Promise<ProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${origin.replace(/\/$/, '')}/healthcheck`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'HearthShelf-ControlPlane/1.0 (reachability probe)' },
    })
    // Any answer (even 3xx/4xx) proves the origin is up and TLS validated. We
    // only treat a 5xx as offline-ish; otherwise it's online.
    if (res.status >= 500) {
      return { status: 'offline', httpStatus: res.status, detail: 'server_error' }
    }
    return { status: 'online', httpStatus: res.status }
  } catch (err) {
    const detail = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'unreachable'
    return { status: 'offline', detail }
  } finally {
    clearTimeout(timer)
  }
}
