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

export interface LocalUrlValidation {
  ok: boolean
  reason?: 'not_absolute' | 'bad_scheme' | 'not_private' | 'bad_host' | 'too_long'
  origin?: string
}

/**
 * Is this hostname a private, link-local, or otherwise non-public target?
 *
 * Used in TWO opposite ways, and both matter:
 *   - validateLocalUrl REQUIRES true (a LAN address must be private)
 *   - assertNotPrivateTarget REQUIRES false (we must never fetch private space)
 *
 * Sharing one implementation means the "what counts as private" definition cannot
 * drift between the write path and the fetch guard, which is exactly the kind of
 * gap that turns into an SSRF hole.
 */
export function isPrivateHost(rawHost: string): boolean {
  let host = rawHost.toLowerCase()
  // Strip IPv6 brackets.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // mDNS / link-local naming. Cannot be resolved by us and only means anything on
  // the client's own network.
  if (host === 'local' || host.endsWith('.local')) return true

  if (IPV4.test(host)) {
    const o = host.split('.').map(Number)
    if (o.some((n) => n > 255)) return false
    const [a, b] = o
    return (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local
      a === 0 ||
      a >= 224 // multicast / reserved
    )
  }

  // IPv6 forms we treat as non-public: loopback, unique-local (fc00::/7),
  // link-local (fe80::/10), unspecified, and v4-mapped private space.
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true // fe80::/10
    // ::ffff:a.b.c.d - recurse on the embedded v4 literal.
    const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
    if (m) return isPrivateHost(m[1])
    return false
  }

  return false
}

/**
 * Validate a LAN address reported by a server.
 *
 * Deliberately the INVERSE of validatePublicUrl: this one REQUIRES a private
 * host and permits plain http (a private IP can't carry a CA-valid cert). Kept as
 * a separate function rather than a flag on validatePublicUrl, because
 * validatePublicUrl gates /pairing/redeem, /pairing/update-url and
 * /servers/public-url - loosening it would let a private or http origin become a
 * server's PUBLIC address, which the hosted SPA would then try to reach from a
 * public page (mixed content at best, a rebinding target at worst).
 */
export function validateLocalUrl(raw: string): LocalUrlValidation {
  if (typeof raw !== 'string' || raw.length > 300) return { ok: false, reason: 'too_long' }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'not_absolute' }
  }
  // http is the expected case; https is allowed for a box with a real cert on a
  // .local name or an internal CA. Nothing else (no file:, no ws:, no data:).
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'bad_scheme' }
  const host = u.hostname
  if (!host) return { ok: false, reason: 'bad_host' }
  // Must be private. A publicly routable address here would (a) duplicate
  // public_url and (b) become an address clients dial without the reachability
  // checks the public path enforces.
  if (!isPrivateHost(host)) return { ok: false, reason: 'not_private' }
  return { ok: true, origin: u.origin }
}

/**
 * Guard for ANY server-side fetch of a server-supplied origin.
 *
 * The pre-existing guard (privateIpInSynthesizedHost) only understands hs.direct
 * names that ENCODE an IP in the hostname. That was sufficient when every stored
 * URL was required to be public. Now that we store private addresses too - in
 * their own table, but one bad join away from here - the fetcher itself must
 * refuse private targets outright rather than trusting callers to pass the right
 * field. Safe-by-construction beats a convention someone has to remember.
 *
 * Returns a refusal reason, or null when the origin is safe to fetch.
 */
export function assertNotPrivateTarget(origin: string): string | null {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return 'bad_origin'
  }
  if (isPrivateHost(host)) return 'private_host'
  // hs.direct names resolve to the IP in their label, so check that too.
  if (privateIpInSynthesizedHost(host)) return 'private_ip'
  return null
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
  // SSRF guard, enforced at the FETCHER rather than the caller: refuse any
  // private/link-local/.local target, plus hs.direct names whose label encodes a
  // private IP (rejected without resolving DNS). Callers cannot opt out, so a
  // future code path that accidentally passes a LAN address - now that we store
  // those - cannot steer the Worker into a customer's network.
  const refusal = assertNotPrivateTarget(origin)
  if (refusal) {
    return { status: 'offline', detail: refusal }
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
