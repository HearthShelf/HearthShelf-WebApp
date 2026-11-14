import assert from 'node:assert/strict'
import test from 'node:test'
import * as flow from '../src/linkSignIn.ts'
import { templates } from '../src/email.ts'

const APP = 'https://app.example'

function memoryStore() {
  const rows = []
  return {
    rows,
    async create(identifier, value, expiresAt) {
      rows.push({ identifier, value, expiresAt })
    },
    async find(identifier) {
      return rows.filter((r) => r.identifier === identifier).at(-1) ?? null
    },
    async consume(identifier) {
      const row = rows.filter((r) => r.identifier === identifier).at(-1)
      if (!row) return null
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].identifier === identifier) rows.splice(i, 1)
      return row
    },
    async count(identifier) {
      return rows.filter((r) => r.identifier === identifier).length
    },
  }
}

function harness() {
  const store = memoryStore()
  const mail = []
  const minted = []
  let clock = Date.UTC(2026, 10, 14, 12)
  const deps = {
    store,
    allowedOrigins: [APP],
    now: () => clock,
    async mint(email, callbackURL) {
      minted.push({ email, callbackURL })
      return `https://auth.example/api/auth/magic-link/verify?token=t${minted.length}&callbackURL=${encodeURIComponent(callbackURL)}`
    },
    async mailApproval(email, url, details) {
      mail.push({ email, url, details })
    },
  }
  return { deps, store, mail, minted, advance: (ms) => (clock += ms) }
}

async function started(h, extra = {}) {
  const res = await flow.start(h.deps, {
    email: 'wife@example.com',
    callbackURL: `${APP}/`,
    device: 'Chrome on Linux',
    location: 'Woodbury, US',
    ip: '192.0.2.1',
    ...extra,
  })
  assert.equal(res.ok, true)
  const link = new URL(h.mail.at(-1).url)
  const params = new URLSearchParams(link.hash.slice(1))
  return { ...res, approveSecret: params.get('k'), link }
}

test('approve hands the verify url to the requester exactly once', async () => {
  const h = harness()
  const req = await started(h)
  assert.match(req.matchCode, /^[1-9]\d$/)
  assert.equal(req.link.origin + req.link.pathname, `${APP}/sign-in/approve`)
  assert.equal(req.link.search, '', 'secrets stay in the fragment')
  assert.equal(h.minted.length, 0, 'no token exists until someone approves')
  assert.ok(
    !h.store.rows.some(
      (r) => r.value.includes(req.pollSecret) || r.value.includes(req.approveSecret),
    ),
  )

  assert.deepEqual(await flow.poll(h.deps, req.requestId, req.pollSecret), {
    ok: true,
    status: 'pending',
  })

  const shown = await flow.info(h.deps, req.requestId, req.approveSecret)
  assert.equal(shown.ok, true)
  assert.equal(shown.matchCode, req.matchCode)
  assert.equal(shown.device, 'Chrome on Linux')
  assert.equal(shown.email, 'wife@example.com')

  assert.equal((await flow.approve(h.deps, req.requestId, req.approveSecret)).ok, true)
  const done = await flow.poll(h.deps, req.requestId, req.pollSecret)
  assert.equal(done.status, 'approved')
  assert.match(done.url, /token=t1/)
  assert.deepEqual(h.minted, [{ email: 'wife@example.com', callbackURL: `${APP}/` }])

  assert.equal((await flow.poll(h.deps, req.requestId, req.pollSecret)).status, 'gone')
  const again = await flow.approve(h.deps, req.requestId, req.approveSecret)
  assert.equal(again.ok, false)
})

test('wrong secrets learn nothing and change nothing', async () => {
  const h = harness()
  const req = await started(h)
  assert.equal((await flow.info(h.deps, req.requestId, req.pollSecret)).ok, false)
  assert.equal((await flow.approve(h.deps, req.requestId, 'nope')).ok, false)
  assert.equal((await flow.poll(h.deps, req.requestId, req.approveSecret)).status, 'gone')
  assert.equal(h.minted.length, 0)
  assert.equal((await flow.poll(h.deps, req.requestId, req.pollSecret)).status, 'pending')

  await flow.approve(h.deps, req.requestId, req.approveSecret)
  assert.equal((await flow.poll(h.deps, req.requestId, 'nope')).status, 'gone')
  assert.equal((await flow.poll(h.deps, req.requestId, req.pollSecret)).status, 'approved')
})

test('deny and sign-in-here close the request without giving the requester a session', async () => {
  const h = harness()
  const a = await started(h)
  assert.equal((await flow.deny(h.deps, a.requestId, a.approveSecret)).ok, true)
  assert.deepEqual(await flow.poll(h.deps, a.requestId, a.pollSecret), {
    ok: true,
    status: 'denied',
  })
  assert.equal(h.minted.length, 0)

  const b = await started(h)
  const here = await flow.signInHere(h.deps, b.requestId, b.approveSecret)
  assert.equal(here.ok, true)
  assert.match(here.url, /magic-link\/verify/)
  const polled = await flow.poll(h.deps, b.requestId, b.pollSecret)
  assert.deepEqual(polled, { ok: true, status: 'elsewhere' })
})

test('requests expire', async () => {
  const h = harness()
  const req = await started(h)
  h.advance(flow.REQUEST_TTL_MS + 1)
  assert.equal((await flow.poll(h.deps, req.requestId, req.pollSecret)).status, 'gone')
  assert.equal((await flow.approve(h.deps, req.requestId, req.approveSecret)).ok, false)
})

test('start rejects bad input and floods', async () => {
  const h = harness()
  assert.equal(
    (await flow.start(h.deps, { email: 'x', callbackURL: `${APP}/` })).error,
    'invalid_email',
  )
  for (const callbackURL of ['https://evil.example/', 'hearthshelf://', '/relative', 42]) {
    const res = await flow.start(h.deps, { email: 'a@example.com', callbackURL })
    assert.equal(res.error, 'invalid_callback', String(callbackURL))
  }
  for (let i = 0; i < flow.START_LIMITS.perEmail; i++) await started(h)
  const limited = await flow.start(h.deps, { email: 'WIFE@example.com', callbackURL: `${APP}/` })
  assert.equal(limited.status, 429)
})

test('approval email asks for approval and carries no sign-in link of its own', () => {
  const url = `${APP}/sign-in/approve#r=abc&k=def`
  const email = templates.linkApproval(url, {
    device: 'Chrome on Linux',
    time: 'Nov 14, 2026, 12:00 PM UTC',
  })
  assert.match(
    email.text,
    /Someone asked to sign in to HearthShelf on another device\. If this was you, open this link and tap Approve/,
  )
  assert.match(email.html, /Chrome on Linux/)
  assert.doesNotMatch(email.html, /magic-link/)
  assert.match(email.text, /#r=abc&k=def/)
})
