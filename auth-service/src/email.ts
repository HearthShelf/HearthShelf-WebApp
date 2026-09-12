/**
 * Delivery and presentation for HearthShelf account email.
 *
 * Credential mail is intentionally separate from preference-driven activity
 * mail: a sign-in code must be terse, security alerts must be impossible to
 * mistake for marketing, and neither may offer an unsubscribe control.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

const HEARTH_GOLD = '#bd863f'
const EMBER = '#e0654a'
const INK = '#1f1d1b'
const MUTED = '#6b6459'
const FAINT = '#6b6459'
const HAIRLINE = '#e6e1d8'
const PAGE = '#f6f3ee'
const WASH = '#f1ece4'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface SendArgs extends RenderedEmail {
  apiKey: string
  from: string
  to: string
}

export interface SignInDetails {
  device?: string
  location?: string
  ip?: string
  time?: string
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 16px;">
    <tr><td bgcolor="${EMBER}" style="border-radius:12px;">
      <a href="${esc(url)}" style="display:inline-block;padding:13px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1;font-weight:700;color:${INK};text-decoration:none;border-radius:12px;">${esc(label)}</a>
    </td></tr>
  </table>`
}

function shell({
  subject,
  preheader,
  title,
  body,
  text,
  action,
  detail,
  afterAction,
}: {
  subject: string
  preheader: string
  title: string
  body: string
  text: string
  action?: { label: string; url: string }
  detail?: string
  afterAction?: string
}): RenderedEmail {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${PAGE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:16px;">
        <tr><td style="padding:26px 28px 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1;">
          <span style="color:${HEARTH_GOLD};font-weight:400;">Hearth</span><span style="color:${INK};font-weight:700;">Shelf</span>
        </td></tr>
        <tr><td style="padding:0 28px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;font-weight:750;color:${INK};">${esc(title)}</h1>
          <div style="font-size:16px;line-height:1.65;color:${MUTED};">${body}</div>
          ${detail ?? ''}
          ${action ? button(action.label, action.url) : ''}
          ${afterAction ?? ''}
        </td></tr>
      </table>
      <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:${FAINT};text-align:center;">
        This is a required account-security message from HearthShelf. Security emails cannot be turned off.
      </p>
    </td></tr>
  </table>
</body>
</html>`
  return { subject, html, text }
}

function linkEmail(kind: 'sign-in' | 'verify' | 'reset', url: string): RenderedEmail {
  const content = {
    'sign-in': {
      subject: 'Your secure link to HearthShelf',
      title: 'Sign in to HearthShelf',
      body: 'Use this private, one-time link to finish signing in.',
      label: 'Sign in securely',
    },
    verify: {
      subject: 'Confirm your email for HearthShelf',
      title: 'Confirm your email',
      body: 'One quick check, then your HearthShelf account is ready.',
      label: 'Confirm my email',
    },
    reset: {
      subject: 'Reset your HearthShelf password',
      title: 'Reset your password',
      body: 'Use this private link to choose a new HearthShelf password.',
      label: 'Reset my password',
    },
  }[kind]
  const safeUrl = esc(url)
  return shell({
    subject: content.subject,
    preheader: content.body,
    title: content.title,
    body: `<p style="margin:0;">${content.body}</p><p style="margin:12px 0 0;font-size:14px;color:${FAINT};">The link expires soon and works once. If you did not request it, you can safely ignore this email.</p>`,
    action: { label: content.label, url },
    text: [
      content.title,
      '',
      content.body,
      url,
      '',
      'The link expires soon and works once.',
      'If you did not request it, you can safely ignore this email.',
    ].join('\n'),
    afterAction: `<p style="margin:0;font-size:12px;line-height:1.5;color:${FAINT};word-break:break-all;">Button not working? Copy this link:<br><a href="${safeUrl}" style="color:${MUTED};text-decoration:underline;text-underline-offset:2px;">${safeUrl}</a></p>`,
  })
}

/** Why an OTP is being sent. Mirrors Better Auth's emailOTP `type`. */
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const OTP_COPY: Record<OtpPurpose, { subject: string; title: string; lead: string }> = {
  'sign-in': {
    subject: 'Your HearthShelf sign-in code',
    title: 'Your sign-in code',
    lead: 'Enter this code to finish signing in to HearthShelf.',
  },
  'email-verification': {
    subject: 'Confirm your HearthShelf email',
    title: 'Confirm your email',
    lead: 'Enter this code to confirm your email address.',
  },
  'forget-password': {
    subject: 'Your HearthShelf password reset code',
    title: 'Reset your password',
    lead: 'Enter this code to continue resetting your password.',
  },
  'change-email': {
    subject: 'Confirm your new HearthShelf email',
    title: 'Confirm your new email',
    lead: 'Enter this code to confirm your new email address.',
  },
}

function detailRows(details: SignInDetails): string {
  const rows = [
    ['Device', details.device],
    ['Location', details.location],
    ['IP address', details.ip],
    ['Time', details.time],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  if (!rows.length) return ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;background:${WASH};border-radius:12px;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="padding:10px 14px;color:${FAINT};font-size:13px;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
          <td style="padding:10px 14px 10px 8px;color:${INK};font-size:13px;font-weight:650;text-align:right;vertical-align:top;">${esc(value)}</td>
        </tr>`,
      )
      .join('')}
  </table>`
}

export const templates = {
  magicLink: (url: string) => linkEmail('sign-in', url),
  verificationLink: (url: string) => linkEmail('verify', url),
  resetPassword: (url: string) => linkEmail('reset', url),

  otp: (code: string, purpose: OtpPurpose): RenderedEmail => {
    const copy = OTP_COPY[purpose]
    return shell({
      subject: copy.subject,
      preheader: copy.lead,
      title: copy.title,
      body: `<p style="margin:0;">${esc(copy.lead)}</p>`,
      detail: `<div style="margin:22px 0 18px;padding:18px 20px;background:${WASH};border-radius:12px;color:${INK};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;line-height:1;font-weight:750;letter-spacing:0.18em;text-align:center;">${esc(code)}</div>
        <p style="margin:0;font-size:13px;line-height:1.55;color:${FAINT};">It expires soon. Never share this code with anyone. HearthShelf support will never ask for it.</p>`,
      text: [
        copy.title,
        '',
        copy.lead,
        '',
        code,
        '',
        'It expires soon. Never share this code with anyone.',
        'If you did not request it, you can safely ignore this email.',
      ].join('\n'),
    })
  },

  passwordChanged: (securityUrl: string): RenderedEmail =>
    shell({
      subject: 'Your HearthShelf password was changed',
      preheader: 'Your HearthShelf password was just changed.',
      title: 'Password changed',
      body: `<p style="margin:0;">Your HearthShelf password was just changed.</p><p style="margin:12px 0 0;font-size:14px;color:${FAINT};">If this was you, there is nothing else to do. If it was not, review your account now and sign out other sessions.</p>`,
      action: { label: 'Review account security', url: securityUrl },
      text: [
        'Password changed',
        '',
        'Your HearthShelf password was just changed.',
        'If this was not you, review your account and sign out other sessions:',
        securityUrl,
      ].join('\n'),
    }),

  /**
   * Confirm an account deletion before it happens.
   *
   * Deletion is irreversible and takes the sign-in identity with it, so it is
   * gated on a link sent to the address on file: someone who has walked up to
   * an unlocked phone cannot delete the account without also holding the email.
   */
  deleteAccount: (url: string): RenderedEmail =>
    shell({
      subject: 'Confirm deleting your HearthShelf account',
      preheader: 'Confirm you want to permanently delete your HearthShelf account.',
      title: 'Delete your account?',
      body: `<p style="margin:0;">You asked to permanently delete your HearthShelf account. This removes your sign-in identity, your linked-server pairings, and your remembered devices.</p><p style="margin:12px 0 0;font-size:14px;color:${FAINT};">This cannot be undone, and it does not touch the books on your own server. If you did not ask for this, ignore this email and nothing will happen.</p>`,
      action: { label: 'Delete my account', url },
      text: [
        'Delete your HearthShelf account?',
        '',
        'You asked to permanently delete your HearthShelf account. This removes your',
        'sign-in identity, your linked-server pairings, and your remembered devices.',
        'It cannot be undone, and it does not touch the books on your own server.',
        '',
        'Confirm here:',
        url,
        '',
        'If you did not ask for this, ignore this email and nothing will happen.',
      ].join('\n'),
    }),

  newSignIn: (securityUrl: string, details: SignInDetails): RenderedEmail => {
    const rows = [
      ['Device', details.device],
      ['Location', details.location],
      ['IP address', details.ip],
      ['Time', details.time],
    ].filter((row): row is [string, string] => Boolean(row[1]))
    return shell({
      subject: 'New sign-in to your HearthShelf account',
      preheader: 'A new sign-in to your HearthShelf account was completed.',
      title: 'New sign-in',
      body: `<p style="margin:0;">A new sign-in to your HearthShelf account was completed.</p><p style="margin:12px 0 0;font-size:14px;color:${FAINT};">If this was you, you are all set. If you do not recognize it, review your account and sign out other sessions.</p>`,
      detail: detailRows(details),
      action: { label: 'Review account security', url: securityUrl },
      text: [
        'New sign-in',
        '',
        'A new sign-in to your HearthShelf account was completed.',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        'If you do not recognize it, review your account and sign out other sessions:',
        securityUrl,
      ].join('\n'),
    })
  },
}

export async function sendMail({ apiKey, from, to, subject, html, text }: SendArgs): Promise<void> {
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from.includes('<') ? from : `HearthShelf <${from}>`,
      to,
      subject,
      html,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`email send failed (${res.status}): ${detail.slice(0, 200)}`)
  }
}
