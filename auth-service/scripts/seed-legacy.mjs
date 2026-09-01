/**
 * Seed the auth database with the accounts carried over from Clerk.
 *
 * Emits SQL and runs it through `wrangler d1 execute`. Idempotent: every
 * statement is an upsert keyed by the legacy id / provider pair, so re-running
 * after a partial failure is safe.
 *
 * WHY THIS EXISTS. Better Auth would happily mint a fresh id for each of these
 * people on first sign-in, and everything would look fine - until a
 * self-hosted box failed to recognise them. `user.id` is the `sub` of every
 * grant the control plane mints, and the primary key of per-user rows on boxes
 * we do not operate (hosted_user_keys.cp_subject, app_installations.cp_subject).
 * Those machines cannot be migrated on our schedule, so the id is permanent.
 * Seeding it verbatim is what makes the provider swap invisible to them.
 *
 * The `account` rows are what let a returning user land on their existing
 * identity: Better Auth matches an incoming social login by
 * (providerId, accountId), so pre-writing the provider subject we already know
 * means the FIRST sign-in attaches rather than creating a duplicate. This is
 * the only mechanism that works for Apple Private Relay users, whose relay
 * email differs per developer team and so cannot be matched by address.
 *
 * Usage:
 *   node scripts/seed-legacy.mjs --local     # local D1
 *   node scripts/seed-legacy.mjs --remote    # deployed D1
 *   node scripts/seed-legacy.mjs --dry-run   # print SQL, touch nothing
 *
 * Input: ../../HS_auth_seed.json (built from the Clerk export; see the
 * migration notes). Override with --seed <path>.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_NAME = 'hearthshelf-auth'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const remote = args.includes('--remote')
const local = args.includes('--local')
const seedArgIdx = args.indexOf('--seed')
const seedPath =
  seedArgIdx >= 0 ? args[seedArgIdx + 1] : resolve(HERE, '../../../HS_auth_seed.json')

if (!dryRun && !remote && !local) {
  console.error('Refusing to guess a target. Pass --local, --remote, or --dry-run.')
  process.exit(1)
}

/** SQL string literal. */
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const { seed } = JSON.parse(readFileSync(seedPath, 'utf8'))
if (!Array.isArray(seed) || !seed.length) {
  console.error(`No seed rows in ${seedPath}`)
  process.exit(1)
}

const statements = []
let accountCount = 0

for (const u of seed) {
  if (!u.legacyId || !u.email) {
    console.error(`Skipping malformed seed row: ${JSON.stringify(u).slice(0, 120)}`)
    continue
  }

  // createdAt preserved so "member since" stays honest across the migration.
  const created = u.createdAt ? new Date(u.createdAt).toISOString() : new Date().toISOString()
  const now = new Date().toISOString()

  // `name` is REQUIRED by the schema; fall back to the username, then the local
  // part of the email, so the column is never empty.
  const name = u.username || u.email.split('@')[0]

  // emailVerified is intentionally taken from the previous provider. These
  // addresses were verified there; re-verifying 15 people would be busywork for
  // them and would block sign-in until they acted.
  statements.push(
    `insert into "user" ("id","name","email","emailVerified","createdAt","updatedAt","username","displayUsername")
     values (${q(u.legacyId)}, ${q(name)}, ${q(u.email)}, ${u.emailVerified ? 1 : 0}, ${q(created)}, ${q(now)}, ${q(u.username || null)}, ${q(u.username || null)})
     on conflict("id") do update set
       "email" = excluded."email",
       "emailVerified" = excluded."emailVerified",
       "username" = excluded."username",
       "displayUsername" = excluded."displayUsername",
       "updatedAt" = excluded."updatedAt";`,
  )

  for (const link of u.oauth ?? []) {
    if (!link.provider || !link.providerAccountId) continue
    accountCount++
    // id is deterministic so re-running cannot create duplicate rows.
    const rowId = `legacy_${u.legacyId}_${link.provider}`
    // `issuer` is REQUIRED and participates in the (issuer, accountId) unique
    // index; Better Auth uses the provider id as the issuer for social logins.
    statements.push(
      `insert into "account" ("id","issuer","accountId","providerId","userId","createdAt","updatedAt")
       values (${q(rowId)}, ${q(link.provider)}, ${q(link.providerAccountId)}, ${q(link.provider)}, ${q(u.legacyId)}, ${q(created)}, ${q(now)})
       on conflict("id") do update set
         "accountId" = excluded."accountId",
         "updatedAt" = excluded."updatedAt";`,
    )
  }

  // Passwords are NOT migrated. Clerk exports a bcrypt digest, but Better Auth
  // hashes with scrypt by default, so a copied digest would simply never
  // verify - and silently, at sign-in. The two accounts that have one recover
  // via magic link or a passkey instead, which is a better credential anyway.
  if (u.hasPassword) {
    console.error(
      `  note: ${u.username || u.email} had a password; not migrated (hash formats differ). They can sign in by magic link and add a passkey.`,
    )
  }
}

const sql = statements.join('\n\n')

if (dryRun) {
  console.log(sql)
  console.error(`\n-- ${seed.length} users, ${accountCount} linked identities (dry run)`)
  process.exit(0)
}

const tmp = resolve(HERE, '.seed-legacy.generated.sql')
writeFileSync(tmp, sql, 'utf8')
try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, remote ? '--remote' : '--local', '--file', tmp],
    { stdio: 'inherit', cwd: resolve(HERE, '..'), shell: process.platform === 'win32' },
  )
  console.error(`\nSeeded ${seed.length} users and ${accountCount} linked identities.`)
} finally {
  unlinkSync(tmp)
}
