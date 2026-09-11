import assert from 'node:assert/strict'
import test from 'node:test'
import { templates } from '../src/email.ts'

test('OTP mail keeps the code in the body and out of the subject', () => {
  const email = templates.otp('650496', 'sign-in')
  assert.equal(email.subject, 'Your HearthShelf sign-in code')
  assert.doesNotMatch(email.subject, /650496/)
  assert.match(email.html, />650496</)
  assert.match(email.text, /650496/)
  assert.match(email.html, /Security emails cannot be turned off/)
  assert.doesNotMatch(email.html, /unsubscribe/i)
})

test('auth links are escaped and retain a plain-text fallback', () => {
  const url = 'https://auth.example/reset?a=1&b=2'
  const email = templates.resetPassword(url)
  assert.match(email.html, /a=1&amp;b=2/)
  assert.match(email.text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(email.html.indexOf('Reset my password') < email.html.indexOf('Button not working?'))
})

test('security alerts show useful sign-in context', () => {
  const email = templates.newSignIn('https://app.example/account/account', {
    device: 'Chrome on Windows',
    location: 'Woodbury, Minnesota, US',
    ip: '192.0.2.1',
    time: 'Sep 11, 2026, 5:30 PM UTC',
  })
  assert.match(email.html, /Chrome on Windows/)
  assert.match(email.html, /Review account security/)
  assert.match(email.text, /Device: Chrome on Windows/)
  assert.match(email.text, /Location: Woodbury, Minnesota, US/)
  assert.match(email.text, /IP address: 192\.0\.2\.1/)
  assert.match(email.text, /Time: Sep 11, 2026, 5:30 PM UTC/)
})
