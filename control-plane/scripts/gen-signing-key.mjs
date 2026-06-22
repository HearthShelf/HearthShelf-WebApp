// Generate an Ed25519 signing keypair as JWK strings for the control plane.
//
// Usage:
//   node scripts/gen-signing-key.mjs
//
// Prints the PRIVATE jwk (set as the CP_SIGNING_JWK secret) and the PUBLIC jwk
// (informational - the Worker derives + serves it via JWKS). Never commit the
// private key. For production: `wrangler secret put CP_SIGNING_JWK` and paste
// the private value.
import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
const priv = await exportJWK(privateKey)
const pub = await exportJWK(publicKey)
const kid = await calculateJwkThumbprint(pub)
priv.kid = kid
priv.alg = 'EdDSA'
pub.kid = kid
pub.alg = 'EdDSA'
pub.use = 'sig'

console.log('# CP_SIGNING_JWK (private - keep secret):')
console.log(JSON.stringify(priv))
console.log('')
console.log('# public (informational):')
console.log(JSON.stringify(pub))
