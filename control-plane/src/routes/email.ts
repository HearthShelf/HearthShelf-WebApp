/**
 * Hosted email relay (server-to-server, server_secret authed).
 *
 *   POST /email/send   a paired HS box sends an email through OUR Resend
 *
 * Why this exists: self-hosters otherwise have to stand up their own SMTP just
 * to deliver e-reader books or test mail. A paired box can instead point ABS at
 * a tiny localhost SMTP shim that forwards here, so the box never holds a Resend
 * credential - only its existing server_secret. We force the From: to our own
 * verified domain (the box doesn't get to spoof a sender), meter every send per
 * server in D1, and enforce a generous soft cap so one box can't burn the shared
 * Resend quota. Eligibility = being paired (a valid server_secret); unpaired
 * self-hosters keep using their own SMTP.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getServer, emailSentThisWindow, incrementEmailSent } from '../lib/db'
import { sendEmail, EmailError, type EmailAttachment } from '../lib/email'
import { sha256Hex, timingSafeEqual } from '../lib/ids'

export const email = new Hono<{ Bindings: Env }>()

/** Generous default monthly cap per server when EMAIL_RELAY_MONTHLY_CAP is unset. */
const DEFAULT_MONTHLY_CAP = 500

function monthlyCap(env: Env): number {
  const n = Number(env.EMAIL_RELAY_MONTHLY_CAP)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_CAP
}

function normalizeRecipient(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** The paired server only needs tiny inline brand assets. Bound the relay input
 * so attachments cannot turn this transactional endpoint into a file service. */
function normalizeAttachments(raw: unknown): EmailAttachment[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 4) return null
  const normalized: EmailAttachment[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null
    const row = value as Record<string, unknown>
    const filename = typeof row.filename === 'string' ? row.filename.trim() : ''
    const content = typeof row.content === 'string' ? row.content : ''
    const contentId = typeof row.content_id === 'string' ? row.content_id.trim() : ''
    if (!filename || filename.length > 128 || /[\\/]/.test(filename)) return null
    if (!content || content.length > 100_000) return null
    if (contentId && (contentId.length >= 128 || !/^[A-Za-z0-9._-]+$/.test(contentId))) return null
    normalized.push({ filename, content, ...(contentId ? { contentId } : {}) })
  }
  return normalized
}

email.post('/email/send', async (c) => {
  let body: {
    server_id?: string
    server_secret?: string
    to?: string
    subject?: string
    html?: string
    text?: string
    reply_to?: string
    attachments?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  const to = normalizeRecipient(body.to)
  const subject = typeof body.subject === 'string' ? body.subject : ''
  const html = typeof body.html === 'string' ? body.html : ''
  const text = typeof body.text === 'string' ? body.text : undefined
  if (!to || !to.includes('@')) return c.json({ error: 'invalid_to' }, 400)
  if (!subject) return c.json({ error: 'subject_required' }, 400)
  // Need a body in at least one format; ABS sends HTML for ereader, text for tests.
  if (!html && !text) return c.json({ error: 'body_required' }, 400)
  const attachments = normalizeAttachments(body.attachments)
  if (attachments === null) return c.json({ error: 'invalid_attachments' }, 400)

  // Soft cap: count first, refuse before spending Resend quota. A paying tier
  // later raises the cap per server rather than changing this gate.
  const cap = monthlyCap(c.env)
  const used = await emailSentThisWindow(c.env, serverId)
  if (used >= cap) {
    return c.json({ error: 'quota_exceeded', cap, used, retry_after_window: 'month' }, 429)
  }

  // From: is always OUR verified domain - the box never picks the sender.
  try {
    const sent = await sendEmail(c.env, {
      to,
      subject,
      html: html || (text as string),
      ...(text ? { text } : {}),
      ...(body.reply_to ? { replyTo: body.reply_to } : {}),
      ...(attachments.length ? { attachments } : {}),
    })
    await incrementEmailSent(c.env, serverId)
    return c.json({ ok: true, id: sent.id, used: used + 1, cap })
  } catch (err) {
    if (!(err instanceof EmailError)) throw err
    // status 0 = relay not configured (no RESEND_API_KEY / EMAIL_FROM); otherwise
    // a Resend failure. Surface as 502 so the shim can retry/queue.
    const status = err.status === 0 ? 503 : 502
    return c.json({ error: 'send_failed', detail: err.message }, status)
  }
})
