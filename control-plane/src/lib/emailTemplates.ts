/** Branded, email-client-safe templates for control-plane invitations. */

const HEARTH_GOLD = '#bd863f'
const EMBER = '#e0654a'
const INK = '#1f1d1b'
const MUTED = '#6b6459'
const FAINT = '#6b6459'
const HAIRLINE = '#e6e1d8'
const PAGE = '#f6f3ee'
const WASH = '#f1ece4'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function subjectText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export interface InviteEmailParams {
  /** Display name of the server they're invited to (falls back to a generic line). */
  serverName: string | null
  /** The XXXX-XXXX invite code, shown so it can be typed into the phone app. */
  code: string
  /** Where the invitee goes to accept / sign up. */
  acceptUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * The same invitation works in both inbox contexts: tap the primary action on
 * a phone, or use the large copyable code when the email is open elsewhere.
 */
export function renderInviteEmail(params: InviteEmailParams): RenderedEmail {
  const libraryName = params.serverName ? subjectText(params.serverName) : ''
  const safeLibrary = esc(libraryName || 'a HearthShelf library')
  const url = esc(params.acceptUrl)
  const code = esc(params.code)
  const subject = libraryName
    ? `Your invitation to ${libraryName} on HearthShelf`
    : 'Your invitation to a HearthShelf library'

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${PAGE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A HearthShelf library is ready for you.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:16px;">
        <tr><td style="padding:26px 28px 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1;">
          <span style="color:${HEARTH_GOLD};font-weight:400;">Hearth</span><span style="color:${INK};font-weight:700;">Shelf</span>
        </td></tr>
        <tr><td style="padding:0 28px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;font-weight:750;color:${INK};">A shelf was opened for you</h1>
          <p style="margin:0;font-size:16px;line-height:1.65;color:${MUTED};">You have been invited to <strong style="color:${INK};">${safeLibrary}</strong>. HearthShelf gives you a comfortable place to browse and listen to the books shared with you.</p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
            <tr><td bgcolor="${EMBER}" style="border-radius:12px;">
              <a href="${url}" style="display:inline-block;padding:13px 22px;font-size:15px;line-height:1;font-weight:700;color:${INK};text-decoration:none;border-radius:12px;">Join the library</a>
            </td></tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background:${WASH};border-radius:12px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:${FAINT};">Opening this somewhere other than your phone? Enter this code in the HearthShelf app:</p>
              <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:27px;line-height:1.1;letter-spacing:0.14em;font-weight:750;color:${INK};">${code}</p>
            </td></tr>
          </table>

          <p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:${FAINT};">This invitation expires in 14 days. HearthShelf is a UI for a library someone chose to share with you; it does not host or provide its content.</p>
        </td></tr>
      </table>
      <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:${FAINT};text-align:center;">Not expecting this invitation? You can safely ignore this email.</p>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    'A shelf was opened for you',
    '',
    `You have been invited to ${libraryName || 'a HearthShelf library'}.`,
    '',
    `Join the library: ${params.acceptUrl}`,
    '',
    'Or enter this code in the HearthShelf app:',
    params.code,
    '',
    'This invitation expires in 14 days.',
    'HearthShelf is a UI for a library someone chose to share with you; it does not host or provide its content.',
    'Not expecting this invitation? You can safely ignore this email.',
  ].join('\n')

  return { subject, html, text }
}
