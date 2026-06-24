/**
 * Resend email client (the part that needs RESEND_API_KEY).
 *
 * Sends transactional + branded email from hearthshelf.com via Resend's HTTP
 * API. We use HTTP (not SMTP) because Cloudflare Workers can't open raw SMTP
 * sockets. Clerk still sends its own sign-up invitation emails separately; this
 * is for email we author ourselves (custom invites, notifications, later
 * newsletters).
 */
import type { Env } from '../types'

const RESEND_API = 'https://api.resend.com'

export interface SentEmail {
  id: string
}

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  /** Plain-text fallback. Recommended for deliverability. */
  text?: string
  /** Overrides EMAIL_FROM for this message (e.g. "no-reply@hearthshelf.com"). */
  from?: string
  replyTo?: string
}

/**
 * Send one email through Resend. Returns the Resend message id, or throws.
 *
 * A missing RESEND_API_KEY throws a (non-fatal-by-convention) EmailError with
 * status 0 so callers can treat "email not configured yet" the same as a send
 * failure and continue with their core work.
 */
export async function sendEmail(env: Env, params: SendEmailParams): Promise<SentEmail> {
  if (!env.RESEND_API_KEY) throw new EmailError(0, 'RESEND_API_KEY not configured')

  const from = params.from ?? env.EMAIL_FROM
  if (!from) throw new EmailError(0, 'EMAIL_FROM not configured')

  const res = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new EmailError(res.status, detail.slice(0, 300))
  }
  const data = (await res.json()) as { id: string }
  return { id: data.id }
}

export class EmailError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
