import assert from 'node:assert/strict'
import test from 'node:test'
import { renderInviteEmail } from '../src/lib/emailTemplates.ts'

test('library invitation supports tap and typed-code paths', () => {
  const email = renderInviteEmail({
    serverName: 'The Family Shelf',
    code: 'ABCD-EFGH',
    acceptUrl: 'https://app.hearthshelf.com/pair?code=ABCD-EFGH',
  })
  assert.match(email.subject, /The Family Shelf/)
  assert.match(email.html, /Join the library/)
  assert.match(email.html, /ABCD-EFGH/)
  assert.match(email.text, /ABCD-EFGH/)
  assert.match(email.html, /does not host or provide its content/)
})

test('library names cannot inject markup or subject headers', () => {
  const email = renderInviteEmail({
    serverName: '<b>Home</b>\r\nBcc: bad@example.com',
    code: 'SAFE-CODE',
    acceptUrl: 'https://app.hearthshelf.com/pair',
  })
  assert.doesNotMatch(email.subject, /\r|\n/)
  assert.match(email.html, /&lt;b&gt;Home&lt;\/b&gt;/)
  assert.doesNotMatch(email.html, /<b>Home<\/b>/)
})
