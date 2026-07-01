/**
 * The control plane's grant-signing machinery.
 *
 * We mint short-lived EdDSA (Ed25519) JWTs that an HS server verifies offline
 * using the public key it pinned at pairing time (and refreshes from our JWKS).
 * EdDSA keys are tiny, fast, and well supported by `jose`. The private key
 * lives only in the CP_SIGNING_JWK secret; the public half is published via
 * /.well-known/jwks.json.
 */
import { importJWK, exportJWK, SignJWT, calculateJwkThumbprint, type JWK } from 'jose'
import type { Env, GrantClaims } from '../types'

interface LoadedKey {
  privateKey: CryptoKey
  publicJwk: JWK
  kid: string
  alg: string
}

let cached: LoadedKey | null = null

/**
 * Load the signing key from the CP_SIGNING_JWK secret. The secret is a JSON JWK
 * for an Ed25519 private key (OKP/Ed25519). We derive a stable `kid` from the
 * public thumbprint so it lines up across JWKS and minted tokens.
 */
export async function loadSigningKey(env: Env): Promise<LoadedKey> {
  if (cached) return cached
  if (!env.CP_SIGNING_JWK) {
    throw new Error('CP_SIGNING_JWK is not configured')
  }
  const jwk = JSON.parse(env.CP_SIGNING_JWK) as JWK
  const alg = 'EdDSA'
  const privateKey = (await importJWK(jwk, alg)) as CryptoKey

  // Public JWK = private JWK minus the private scalar `d`.
  const { d: _d, ...pub } = jwk
  const kid = jwk.kid ?? (await calculateJwkThumbprint(pub as JWK))
  const publicJwk: JWK = { ...pub, kid, alg, use: 'sig' }

  cached = { privateKey, publicJwk, kid, alg }
  return cached
}

/** The JWKS document HS servers fetch to verify our grants. */
export async function jwks(env: Env): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await loadSigningKey(env)
  return { keys: [publicJwk] }
}

/** Mint a short-TTL grant assertion for (clerk user, server). */
export async function mintGrant(
  env: Env,
  params: {
    clerkUserId: string
    serverId: string
    serverUrl: string
    email: string
    username: string
    role: 'admin' | 'user'
  },
): Promise<string> {
  const { privateKey, kid, alg } = await loadSigningKey(env)
  const ttl = Number(env.GRANT_TTL_SECONDS || '300')

  const claims: Omit<GrantClaims, 'iat' | 'exp'> = {
    iss: env.CP_ISSUER,
    sub: params.clerkUserId,
    aud: params.serverId,
    email: params.email,
    email_verified: true,
    username: params.username,
    role: params.role,
    server_url: params.serverUrl,
  }

  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(privateKey)
}

/**
 * Dev helper: generate a fresh Ed25519 keypair as JWK strings. Not called at
 * runtime - run via a one-off script / `wrangler` REPL to produce the value for
 * `wrangler secret put CP_SIGNING_JWK`. Kept here so the keygen recipe lives
 * next to the code that consumes it.
 */
export async function generateSigningJwk(): Promise<{ privateJwk: string; publicJwk: string }> {
  const { generateKeyPair } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  const priv = await exportJWK(privateKey)
  const pub = await exportJWK(publicKey)
  const kid = await calculateJwkThumbprint(pub)
  priv.kid = kid
  priv.alg = 'EdDSA'
  pub.kid = kid
  pub.alg = 'EdDSA'
  pub.use = 'sig'
  return { privateJwk: JSON.stringify(priv), publicJwk: JSON.stringify(pub) }
}
