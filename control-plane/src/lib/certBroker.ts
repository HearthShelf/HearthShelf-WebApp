/**
 * hs.direct cert-broker authorization (control-plane side).
 *
 * Under the hs.direct synthesis design (docs/hs-direct-implementation.md sec 1.2),
 * the control plane does NOT run ACME and never touches a server's private key.
 * Its only role in issuance is to AUTHORIZE a paired server to ask the VPS cert
 * broker for a wildcard cert: it mints a short-lived EdDSA "cert grant" JWT that
 * the broker verifies against our published JWKS. The HS box generates its own
 * key + CSR; the broker (which holds the Cloudflare token) runs DNS-01 and signs.
 *
 * This module owns two pure things:
 *   - the stable per-server `hash` label that forms `<hash>.<zone>`, and
 *   - minting the cert-broker grant (audience "cert-broker").
 *
 * Both are deterministic and side-effect free, so they unit-test without D1.
 */
import { SignJWT } from 'jose'
import type { Env } from '../types'
import { loadSigningKey } from './signing'
import { sha256Hex } from './ids'

/** Audience pinned on cert-broker grants; the broker checks for exactly this. */
export const CERT_BROKER_AUDIENCE = 'cert-broker'

/**
 * The stable hash label for a server's hs.direct subdomain `<hash>.<zone>`.
 *
 * Requirements: stable per `server_id` (the cert wildcard and the OIDC redirect
 * both pin to it, so it must not change across IP changes or re-pairs), a valid
 * single DNS label, and unguessable enough that a stranger can't derive another
 * server's subdomain. We take the first 32 hex chars (128 bits) of
 * SHA-256(server_id) - lowercase, digit/letter only, matches the broker's
 * `^[a-z0-9]{8,64}$` rule.
 *
 * Note: this is not a secret (it appears in the public hostname), but deriving
 * it from server_id means two servers never collide and we store nothing extra.
 */
export async function serverHash(serverId: string): Promise<string> {
  const hex = await sha256Hex(`hsdirect:${serverId}`)
  return hex.slice(0, 32)
}

/** The hs.direct base zone (POC d.hearthshelf.com; prod swaps via env). */
export function hsDirectZone(env: Env): string {
  return (env.HSDIRECT_ZONE || 'd.hearthshelf.com').replace(/\.+$/, '').toLowerCase()
}

/**
 * The stable canonical hostname for a server: `<hash>.<zone>`. This is the host
 * the OIDC redirect pins and the cert wildcard covers. The IP-bearing form
 * `<ip-label>.<hash>.<zone>` is computed on the HS box at runtime, not here.
 */
export async function stableHost(env: Env, serverId: string): Promise<string> {
  return `${await serverHash(serverId)}.${hsDirectZone(env)}`
}

/**
 * Mint a short-TTL grant that authorizes the given server to obtain a cert for
 * its `<hash>` from the VPS broker. The broker verifies the signature against
 * our JWKS and checks `aud`, `server_id`, and `hash` match the request.
 */
export async function mintCertGrant(
  env: Env,
  params: { serverId: string }
): Promise<{ token: string; hash: string; host: string }> {
  const { privateKey, kid, alg } = await loadSigningKey(env)
  const hash = await serverHash(params.serverId)
  const ttl = Number(env.CERT_GRANT_TTL_SECONDS || '300')

  const token = await new SignJWT({
    iss: env.CP_ISSUER,
    aud: CERT_BROKER_AUDIENCE,
    server_id: params.serverId,
    hash,
  })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(privateKey)

  return { token, hash, host: `${hash}.${hsDirectZone(env)}` }
}
