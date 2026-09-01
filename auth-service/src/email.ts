/**
 * Outbound mail for the authentication paths.
 *
 * Magic links and email OTP make delivery security-critical rather than
 * cosmetic: if mail does not arrive, those sign-in methods are DOWN. Passkeys
 * and social sign-in are unaffected, which is the main reason the service
 * offers all of them rather than leaning on one.
 *
 * Failures throw so Better Auth surfaces "we could not send that" to the user
 * instead of silently pretending a code is on its way.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface SendArgs {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
}

export async function sendMail({ apiKey, from, to, subject, text }: SendArgs): Promise<void> {
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`email send failed (${res.status}): ${detail.slice(0, 200)}`)
  }
}

/** Why an OTP is being sent. Mirrors Better Auth's emailOTP `type`. */
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

/** Plain-text bodies. Deliberately terse: short-lived codes and links age out,
 *  and a wall of marketing copy around a credential reads as phishing. */
export const templates = {
  magicLink: (url: string) =>
    [
      'Tap the link below to sign in to HearthShelf.',
      '',
      url,
      '',
      'This link expires shortly and can only be used once.',
      'If you did not ask to sign in, you can ignore this email.',
    ].join('\n'),

  otp: (code: string, purpose: OtpPurpose) =>
    [
      purpose === 'forget-password'
        ? 'Use this code to reset your HearthShelf password:'
        : purpose === 'email-verification'
          ? 'Use this code to confirm your email address:'
          : purpose === 'change-email'
            ? 'Use this code to confirm your new email address:'
            : 'Use this code to sign in to HearthShelf:',
      '',
      code,
      '',
      'The code expires shortly. If you did not ask for it, you can ignore this email.',
    ].join('\n'),
}
