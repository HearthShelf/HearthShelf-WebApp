/**
 * "Sign in this device" by email link.
 *
 * A plain magic link signs in whichever device OPENS it. That is wrong when the
 * device asking is a car or a TV and the email is read on a phone: the phone got
 * the session and the car, which asked, was left on the sign-in page.
 *
 * This flow keeps the session on the device that asked, the same shape as TV
 * sign-in:
 *
 *   1. start    The requesting device asks. We store a pending request and mail
 *               a link to an APPROVAL page (not a sign-in link). The requester
 *               gets back a request id, a poll secret and a short match code.
 *   2. approve  Whoever opens the email sees the match code and what device
 *               asked, and taps Approve (or Deny, or "sign in here instead").
 *               Approve mints a real Better Auth magic link token, kept only in
 *               a short-lived result row.
 *   3. poll     The requesting device polls with its secret. Once approved, the
 *               verify URL is handed over ONCE and the requester navigates to
 *               Better Auth's own /magic-link/verify, so every cookie and hook
 *               (multi-session included) is set by Better Auth, in the browser
 *               that asked.
 *
 * The magic link token is minted at approval, not at start, so the five-minute
 * life of a Better Auth magic link starts when the requester is about to use it.
 *
 * Rows live in Better Auth's `verification` table (no migration). Only hashes
 * of the poll and approve secrets are stored.
 *
 * This file has no runtime imports so the node test runner can load it as-is.
 */

/** How long the email's approval link stays usable. */
export const REQUEST_TTL_MS = 15 * 60_000
/** How long an approval waits for the requester to collect it. Matches Better
 *  Auth's default magic link life (300s), since the token expires then anyway. */
export const RESULT_TTL_MS = 5 * 60_000

export const START_LIMITS = {
  windowMs: 10 * 60_000,
  perEmail: 5,
  perIp: 20,
}

const PREFIX = 'hs-link-sign-in'
const reqId = (id: string) => `${PREFIX}:req:${id}`
const doneId = (id: string) => `${PREFIX}:done:${id}`
const rateId = (key: string, bucket: number) => `${PREFIX}:rate:${key}:${bucket}`

export interface StoredRow {
  value: string
  expiresAt: Date
}

/** The slice of Better Auth's internal adapter this flow needs. */
export interface LinkStore {
  create(identifier: string, value: string, expiresAt: Date): Promise<void>
  find(identifier: string): Promise<StoredRow | null>
  /** Atomic: the first caller gets the row, everyone after gets null. */
  consume(identifier: string): Promise<StoredRow | null>
  count(identifier: string): Promise<number>
}

export interface RequestContext {
  device?: string
  location?: string
  ip?: string
}

export interface LinkDeps {
  store: LinkStore
  /** Origins a callbackURL may point at (the web app). */
  allowedOrigins: string[]
  /** Mint a Better Auth magic link for `email` and return its verify URL. */
  mint(email: string, callbackURL: string): Promise<string>
  /** Mail the approval link. */
  mailApproval(
    email: string,
    approveUrl: string,
    details: RequestContext & { time: string },
  ): Promise<void>
  now?: () => number
}

interface RequestRecord {
  v: 1
  email: string
  callbackURL: string
  pollHash: string
  approveHash: string
  matchCode: string
  device?: string
  location?: string
  requestedAt: number
}

type Outcome = 'approved' | 'denied' | 'elsewhere'

interface ResultRecord {
  v: 1
  pollHash: string
  outcome: Outcome
  url?: string
}

export type Failure = { ok: false; status: number; error: string }
export type Result<T> = ({ ok: true } & T) | Failure

const fail = (status: number, error: string): Failure => ({ ok: false, status, error })

// ---------------------------------------------------------------- crypto helpers

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Two digits, 10-99: no leading zero to misread. */
export function randomMatchCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  return String(10 + (n % 90))
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return toBase64Url(new Uint8Array(digest))
}

/** Compare two equal-length hashes without an early exit. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function secretMatches(secret: unknown, hash: string): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || secret.length > 200) return false
  return safeEqual(await hashSecret(secret), hash)
}

function parse<T>(row: StoredRow | null, now: number): T | null {
  if (!row || row.expiresAt.getTime() <= now) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

const isId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(id)

// ---------------------------------------------------------------- start

export interface StartInput extends RequestContext {
  email: unknown
  callbackURL: unknown
}

export interface StartOutput {
  requestId: string
  pollSecret: string
  matchCode: string
  expiresAt: number
}

function validEmail(email: unknown): email is string {
  return (
    typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
}

/** The callback must be an absolute URL on the web app. This flow is web only:
 *  a phone app keeps using the plain magic link. */
function callbackOrigin(callbackURL: unknown, allowed: string[]): string | null {
  if (typeof callbackURL !== 'string' || callbackURL.length > 2000) return null
  try {
    const url = new URL(callbackURL)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return allowed.includes(url.origin) ? url.origin : null
  } catch {
    return null
  }
}

async function overLimit(
  store: LinkStore,
  key: string,
  max: number,
  now: number,
): Promise<boolean> {
  const bucket = Math.floor(now / START_LIMITS.windowMs)
  const id = rateId(key, bucket)
  if ((await store.count(id)) >= max) return true
  await store.create(id, '1', new Date((bucket + 2) * START_LIMITS.windowMs))
  return false
}

export async function start(deps: LinkDeps, input: StartInput): Promise<Result<StartOutput>> {
  const now = deps.now?.() ?? Date.now()
  const email = typeof input.email === 'string' ? input.email.trim() : input.email
  if (!validEmail(email)) return fail(400, 'invalid_email')
  const origin = callbackOrigin(input.callbackURL, deps.allowedOrigins)
  if (!origin) return fail(400, 'invalid_callback')

  // Per email first, so one address cannot be flooded from many IPs, then per IP.
  if (
    await overLimit(
      deps.store,
      `e:${await hashSecret(email.toLowerCase())}`,
      START_LIMITS.perEmail,
      now,
    )
  ) {
    return fail(429, 'too_many_requests')
  }
  if (
    input.ip &&
    (await overLimit(deps.store, `i:${await hashSecret(input.ip)}`, START_LIMITS.perIp, now))
  ) {
    return fail(429, 'too_many_requests')
  }

  const requestId = randomToken(16)
  const pollSecret = randomToken(32)
  const approveSecret = randomToken(32)
  const matchCode = randomMatchCode()
  const expiresAt = now + REQUEST_TTL_MS
  const record: RequestRecord = {
    v: 1,
    email,
    callbackURL: input.callbackURL as string,
    pollHash: await hashSecret(pollSecret),
    approveHash: await hashSecret(approveSecret),
    matchCode,
    ...(input.device ? { device: input.device } : {}),
    ...(input.location ? { location: input.location } : {}),
    requestedAt: now,
  }
  await deps.store.create(reqId(requestId), JSON.stringify(record), new Date(expiresAt))

  // In the fragment, not the query: a fragment never reaches a server, so the
  // secret stays out of every access log and Referer header on the way.
  const approveUrl = `${origin}/sign-in/approve#r=${requestId}&k=${approveSecret}`
  const time =
    new Date(now).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }) + ' UTC'
  await deps.mailApproval(email, approveUrl, {
    device: input.device,
    location: input.location,
    time,
  })

  return { ok: true, requestId, pollSecret, matchCode, expiresAt }
}

// ---------------------------------------------------------------- approval side

async function loadForApproval(
  deps: LinkDeps,
  requestId: unknown,
  approveSecret: unknown,
): Promise<Result<{ record: RequestRecord; expiresAt: number }>> {
  const now = deps.now?.() ?? Date.now()
  if (!isId(requestId)) return fail(404, 'not_found')
  const row = await deps.store.find(reqId(requestId))
  const record = parse<RequestRecord>(row, now)
  // A wrong secret reads the same as a missing request: no oracle for ids.
  if (!record || !row || !(await secretMatches(approveSecret, record.approveHash))) {
    return fail(404, 'not_found')
  }
  return { ok: true, record, expiresAt: row.expiresAt.getTime() }
}

export interface InfoOutput {
  email: string
  matchCode: string
  device?: string
  location?: string
  requestedAt: number
  expiresAt: number
}

export async function info(
  deps: LinkDeps,
  requestId: unknown,
  approveSecret: unknown,
): Promise<Result<InfoOutput>> {
  const loaded = await loadForApproval(deps, requestId, approveSecret)
  if (!loaded.ok) return loaded
  const { record, expiresAt } = loaded
  return {
    ok: true,
    email: record.email,
    matchCode: record.matchCode,
    ...(record.device ? { device: record.device } : {}),
    ...(record.location ? { location: record.location } : {}),
    requestedAt: record.requestedAt,
    expiresAt,
  }
}

/**
 * Close a request with an outcome. The request row is consumed atomically, so
 * of two racing decisions exactly one wins; the loser sees `already_used`.
 *
 * For outcomes that sign someone in, the token is minted BEFORE the consume:
 * a mint that fails then leaves the request open to try again, and a race
 * loser only leaves behind an unused token that nobody ever sees and that
 * expires on its own.
 */
async function decide(
  deps: LinkDeps,
  requestId: unknown,
  approveSecret: unknown,
  outcome: Outcome,
): Promise<Result<{ url?: string }>> {
  const loaded = await loadForApproval(deps, requestId, approveSecret)
  if (!loaded.ok) return loaded
  const id = requestId as string
  const { record } = loaded
  const url = outcome === 'denied' ? undefined : await deps.mint(record.email, record.callbackURL)
  const consumed = await deps.store.consume(reqId(id))
  if (!consumed) return fail(409, 'already_used')
  const now = deps.now?.() ?? Date.now()
  const result: ResultRecord = {
    v: 1,
    pollHash: record.pollHash,
    outcome,
    // Only an approval hands a sign-in to the requester. "Sign in here instead"
    // returns its url to the approver below and tells the requester nothing more.
    ...(outcome === 'approved' ? { url } : {}),
  }
  await deps.store.create(doneId(id), JSON.stringify(result), new Date(now + RESULT_TTL_MS))
  return { ok: true, ...(outcome === 'elsewhere' ? { url } : {}) }
}

export const approve = (deps: LinkDeps, requestId: unknown, approveSecret: unknown) =>
  decide(deps, requestId, approveSecret, 'approved')

export const deny = (deps: LinkDeps, requestId: unknown, approveSecret: unknown) =>
  decide(deps, requestId, approveSecret, 'denied')

/** Sign in the device holding the email instead: the old magic link behavior. */
export const signInHere = (deps: LinkDeps, requestId: unknown, approveSecret: unknown) =>
  decide(deps, requestId, approveSecret, 'elsewhere')

// ---------------------------------------------------------------- requester side

export type PollStatus = 'pending' | 'approved' | 'denied' | 'elsewhere' | 'gone'

export async function poll(
  deps: LinkDeps,
  requestId: unknown,
  pollSecret: unknown,
): Promise<Result<{ status: PollStatus; url?: string }>> {
  const now = deps.now?.() ?? Date.now()
  if (!isId(requestId)) return { ok: true, status: 'gone' }

  const done = parse<ResultRecord>(await deps.store.find(doneId(requestId)), now)
  if (done && (await secretMatches(pollSecret, done.pollHash))) {
    if (done.outcome !== 'approved') return { ok: true, status: done.outcome }
    // Released once: a second poll (or a copied secret) finds nothing.
    const taken = parse<ResultRecord>(await deps.store.consume(doneId(requestId)), now)
    if (!taken?.url) return { ok: true, status: 'gone' }
    return { ok: true, status: 'approved', url: taken.url }
  }

  const pending = parse<RequestRecord>(await deps.store.find(reqId(requestId)), now)
  if (pending && (await secretMatches(pollSecret, pending.pollHash)))
    return { ok: true, status: 'pending' }

  return { ok: true, status: 'gone' }
}
