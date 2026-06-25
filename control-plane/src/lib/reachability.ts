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

/**
 * Refuse hs.direct hostnames whose ENCODED IP is in a private/reserved range.
 *
 * A synthesized hs.direct name `<a-b-c-d>.<hash>.<zone>` resolves (by design) to
 * `a.b.c.d`, which may be a private LAN address - that is the feature, but it is
 * also textbook DNS-rebinding/SSRF shape. Because the IP is IN the name, we can
 * reject a private target *without resolving DNS at all*: parse the first label's
 * four octets and check the range. Any server-side fetch of a synthesized host
 * (e.g. probeServer) calls this first so the control plane can never be steered
 * at internal space. See docs/hs-direct-implementation.md sec 1.1 (rebinding
 * caveat) and build step 5.
 *
 * Returns the private IP string if the host encodes a private/reserved address
 * (caller should refuse), or null if the host is safe to fetch (public IP label,
 * or not a synthesized name at all - a normal public domain).
 */
export function privateIpInSynthesizedHost(host: string): string | null {
  const label = host.toLowerCase().split('.')[0]
  const m = /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})$/.exec(label)
  if (!m) return null // not an IP-bearing synthesized label; nothing to refuse here
  const o = m.slice(1).map((n) => Number(n))
  if (o.some((n) => n > 255)) return null // malformed; let normal validation handle
  const [a, b] = o
  const isPrivate =
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    a === 0 || // "this network"
    a >= 224 // multicast / reserved
  return isPrivate ? o.join('.') : null
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
  // SSRF guard: if this is an hs.direct synthesized host encoding a private IP,
  // refuse without fetching. The Worker's egress can't reach private space anyway,
  // but failing fast here is explicit and avoids a misleading timeout. A LAN-only
  // server reads as offline from the internet, which is the correct advisory.
  let host = ''
  try {
    host = new URL(origin).hostname
  } catch {
    return { status: 'offline', detail: 'bad_origin' }
  }
  const priv = privateIpInSynthesizedHost(host)
  if (priv) {
    return { status: 'offline', detail: 'private_ip' }
  }

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
