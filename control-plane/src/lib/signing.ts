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
 * Mint an INTRODUCTION token: the app's one-time letter of introduction to a
 * single server, handed over after the user approves a connection.
 *
 * This is deliberately NOT a refresh token. The control plane introduces an app
 * to a box and then gets out of the way - the box issues the credential the app
 * actually lives on, which is what makes revocation instant and lets an
 * established connection keep working with the control plane unreachable.
 *
 * `aud` stays a SINGLE server id, exactly like a user grant. The box verifies it
 * with `jwtVerify(..., { audience: serverId })`, a strict single-value check, so
 * an array here would fail verification outright - and loosening that check
 * would destroy the property that a token minted for server A cannot be replayed
 * against server B. An app authorized for three servers therefore gets three
 * introduction tokens, one per server.
 *
 * `typ: 'app_introduction'` is load-bearing: it stops a user grant and an app
 * introduction being interchangeable at the box. Without it, an app introduction
 * would verify anywhere a user grant does, and vice versa.
 */
export async function mintAppIntroduction(
  env: Env,
  params: {
    appId: string
    appName: string
    appKind: 'instance' | 'cloud'
    family: string | null
    clerkUserId: string
    serverId: string
    serverUrl: string
    email: string
    username: string
    role: 'admin' | 'user'
    scopes: string[]
  },
): Promise<string> {
  const { privateKey, kid, alg } = await loadSigningKey(env)
  const ttl = Number(env.APP_INTRO_TTL_SECONDS || '300')

  return new SignJWT({
    iss: env.CP_ISSUER,
    sub: params.clerkUserId,
    aud: params.serverId,
    typ: 'app_introduction',
    app_id: params.appId,
    app_name: params.appName,
    app_kind: params.appKind,
    app_family: params.family,
    scopes: params.scopes,
    email: params.email,
    email_verified: true,
    username: params.username,
    role: params.role,
    server_url: params.serverUrl,
  })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(crypto.randomUUID())
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
