/**
 * Mint the Apple `client_secret`.
 *
 * Apple is the odd one out among the social providers: it does not issue a
 * client secret you can paste. You sign one yourself - an ES256 JWT over your
 * team id, key id and the .p8 private key - and Apple caps its lifetime at six
 * months, so it is a credential that MUST be rotated on a calendar rather than
 * set once and forgotten.
 *
 * Better Auth's Apple provider takes the finished JWT as `clientSecret`, so
 * this runs here rather than in the Worker.
 *
 * Usage (values come from your Apple developer account, and are what
 * HearthShelf/.env already holds):
 *
 *   node scripts/apple-client-secret.mjs \
 *     --team-id ABCDE12345 \
 *     --key-id FGHIJ67890 \
 *     --client-id com.hearthshelf.signin \
 *     --key ./AuthKey_FGHIJ67890.p8
 *
 * Prints the JWT to stdout. Pipe it straight into wrangler:
 *
 *   node scripts/apple-client-secret.mjs ... | npx wrangler secret put APPLE_CLIENT_SECRET
 *
 * IMPORTANT: `--client-id` is the SERVICES ID (the web sign-in identifier),
 * not the app's bundle id. Using the bundle id yields tokens Apple rejects at
 * the token endpoint with a generic invalid_client, which is a miserable thing
 * to debug.
 */
import { readFileSync } from 'node:fs'
import { SignJWT, importPKCS8 } from 'jose'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const teamId = arg('team-id')
const keyId = arg('key-id')
const clientId = arg('client-id')
const keyPath = arg('key')

if (!teamId || !keyId || !clientId || !keyPath) {
  console.error(
    'Usage: node scripts/apple-client-secret.mjs --team-id <T> --key-id <K> --client-id <servicesId> --key <AuthKey_K.p8>',
  )
  process.exit(1)
}

// Apple's ceiling is 6 months; sit just under it so a secret minted today is
// valid for as long as Apple allows without being rejected as over-long.
const SIX_MONTHS_SEC = 15777000

const pkcs8 = readFileSync(keyPath, 'utf8')
const key = await importPKCS8(pkcs8, 'ES256')

const now = Math.floor(Date.now() / 1000)
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: 'ES256', kid: keyId })
  .setIssuer(teamId)
  .setIssuedAt(now)
  .setExpirationTime(now + SIX_MONTHS_SEC)
  .setAudience('https://appleid.apple.com')
  .setSubject(clientId)
  .sign(key)

process.stdout.write(jwt)

const expires = new Date((now + SIX_MONTHS_SEC) * 1000).toISOString().slice(0, 10)
console.error(`\n\nExpires ${expires} - Apple sign-in breaks that day unless this is re-minted.`)
