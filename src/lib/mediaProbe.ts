/**
 * Look at the first bytes of an audio URL the <audio> element refused, so an
 * error report can say what the browser actually received: the HTTP status,
 * the content type, and the file's top-level MP4 boxes ("ftyp:32 moov:2.4MB
 * mdat"). A media element only reports "not supported"; this tells a broken or
 * cut-off response apart from a file the browser cannot read.
 *
 * Best-effort: any failure (network, CORS, timeout) is returned as the summary.
 */

const PROBE_BYTES = 65536
const PROBE_TIMEOUT_MS = 10_000

export interface MediaProbe {
  status: string
  contentType: string
  boxes: string
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return String(n)
}

/** Top-level MP4 boxes in `buf`, e.g. "ftyp:32 free:8 moov:2.4MB mdat:210MB". */
function listBoxes(buf: ArrayBuffer): string {
  const view = new DataView(buf)
  const out: string[] = []
  let off = 0
  while (off + 8 <= view.byteLength && out.length < 8) {
    let size = view.getUint32(off)
    const type = String.fromCharCode(
      view.getUint8(off + 4),
      view.getUint8(off + 5),
      view.getUint8(off + 6),
      view.getUint8(off + 7),
    )
    if (!/^[\x20-\x7e]{4}$/.test(type)) {
      out.push(`?bytes@${off}`)
      break
    }
    if (size === 1 && off + 16 <= view.byteLength) {
      size = Number(view.getBigUint64(off + 8))
    }
    out.push(`${type}:${fmtSize(size)}`)
    if (size < 8) break
    off += size
  }
  return out.join(' ') || 'empty'
}

export async function probeMedia(url: string): Promise<MediaProbe> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    const contentType = res.headers.get('content-type') ?? 'none'
    const buf = await res.arrayBuffer()
    return {
      status: `${res.status} (${fmtSize(buf.byteLength)} read)`,
      contentType,
      boxes: res.ok ? listBoxes(buf) : new TextDecoder().decode(buf.slice(0, 120)),
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { status: `fetch failed: ${msg}`.slice(0, 190), contentType: 'none', boxes: 'none' }
  } finally {
    clearTimeout(timer)
  }
}
