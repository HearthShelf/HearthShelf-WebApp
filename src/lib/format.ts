// Shared formatting helpers for the player and listening views.

// Clock-style timestamp for chapter/book offsets. 3725 -> "1:02:05", 125 -> "2:05".
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// ABS stores book descriptions as HTML. Render them as plain text by stripping
// tags and decoding the few entities ABS commonly emits.
export function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Relative day + local clock label for a session timestamp (epoch ms).
// Returns { day: "Today"/"Yesterday"/weekday/short-date, time: "3:42 PM" }.
export function fmtSessDate(ms: number): { day: string; time: string } {
  const d = new Date(ms)
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((day0.getTime() - that.getTime()) / 86400000)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  let day: string
  if (diff <= 0) day = 'Today'
  else if (diff === 1) day = 'Yesterday'
  else if (diff < 7) day = d.toLocaleDateString([], { weekday: 'long' })
  else day = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return { day, time }
}
