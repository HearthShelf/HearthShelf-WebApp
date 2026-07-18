/**
 * Branded HTML email templates rendered to inline-styled markup (email clients
 * don't reliably support <style> blocks or external CSS). Kept dependency-free:
 * plain template strings, escaped where user/server data is interpolated.
 */

/** Escape a string for safe interpolation into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
 * "You've been invited to a HearthShelf library" - the only invite email we
 * send. Carries BOTH a tap-to-accept link (best case: opens the phone app
 * directly) and the code in readable form, because someone reading this on a
 * desktop still has to get the invite into their phone somehow.
 */
export function renderInviteEmail(params: InviteEmailParams): RenderedEmail {
  const lib = params.serverName
    ? `the "${esc(params.serverName)}" library`
    : 'a HearthShelf library'
  const url = esc(params.acceptUrl)
  const code = esc(params.code)

  const subject = params.serverName
    ? `You're invited to "${params.serverName}" on HearthShelf`
    : `You're invited to a HearthShelf library`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0;font-size:20px;color:#18181b;">HearthShelf</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;color:#3f3f46;font-size:15px;line-height:1.5;">
                <p style="margin:0 0 16px 0;">You've been invited to ${lib} on HearthShelf - your audiobook library, anywhere.</p>
                <p style="margin:0 0 24px 0;">Open this on your phone to join right away:</p>
                <a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;">Join the library</a>
                <p style="margin:28px 0 8px 0;font-size:13px;color:#71717a;">Reading this on a computer? Install HearthShelf on your phone, then enter this invite code:</p>
                <p style="margin:0 0 4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;letter-spacing:3px;color:#18181b;font-weight:600;">${code}</p>
                <p style="margin:16px 0 0 0;font-size:12px;color:#a1a1aa;">This invite expires in 14 days.</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:12px;color:#a1a1aa;">If you weren't expecting this, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `You've been invited to ${params.serverName ? `the "${params.serverName}" library` : 'a HearthShelf library'} on HearthShelf.`,
    ``,
    `Open this on your phone to join:`,
    params.acceptUrl,
    ``,
    `Or install HearthShelf on your phone and enter this invite code:`,
    params.code,
    ``,
    `This invite expires in 14 days.`,
    `If you weren't expecting this, you can ignore this email.`,
  ].join('\n')

  return { subject, html, text }
}
