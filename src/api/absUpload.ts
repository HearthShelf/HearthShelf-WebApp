/**
 * ABS multipart upload over the direct ABS client (the WebApp data path).
 *
 * Ports the self-hosted HS uploader (src/api/upload.ts) to the hosted contract:
 * instead of a same-origin /abs-api proxy + a `?token=` URL, it talks straight to
 * the active server (`${target.serverUrl}/api/upload`) and carries the in-memory
 * ABS access token as an Authorization header on the XHR. XHR (not fetch) is used
 * because only XHR reports byte-level upload progress.
 *
 * File-type constants + classifiers mirror ABS's SupportedFileTypes (constants.js)
 * and drive the picker `accept` filter and the client-side "ignored files" hint.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'

// Accepted file extensions, mirroring ABS's SupportedFileTypes (constants.js).
// Audio + ebook + the metadata/image/info/text sidecars ABS keeps alongside an
// item. The server ultimately decides what it keeps; this just drives the file
// picker's `accept` filter and the client-side "ignored files" hint.
export const SUPPORTED_AUDIO = [
  'm4b', 'mp3', 'm4a', 'flac', 'opus', 'ogg', 'oga', 'mp4', 'aac', 'wma',
  'aiff', 'aif', 'wav', 'webm', 'webma', 'mka', 'awb', 'caf', 'mpeg', 'mpg',
]
export const SUPPORTED_EBOOK = ['epub', 'pdf', 'mobi', 'azw3', 'cbr', 'cbz']
export const SUPPORTED_IMAGE = ['png', 'jpg', 'jpeg', 'webp']
export const SUPPORTED_OTHER = ['nfo', 'txt', 'opf', 'abs', 'xml', 'json']

export type UploadFileKind = 'audio' | 'ebook' | 'image' | 'other'

export function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// Classify a file by extension. Returns null when ABS would ignore it entirely.
export function classifyFile(name: string): UploadFileKind | null {
  const ext = fileExt(name)
  if (!ext) return null
  if (SUPPORTED_AUDIO.includes(ext)) return 'audio'
  if (SUPPORTED_EBOOK.includes(ext)) return 'ebook'
  if (SUPPORTED_IMAGE.includes(ext)) return 'image'
  if (SUPPORTED_OTHER.includes(ext)) return 'other'
  return null
}

// `accept` string for <input type="file">. Books take audio + ebook; podcasts
// are audio-only. Sidecar (image/other) files ride along but aren't offered
// directly in the picker - matching the ABS uploader.
export function acceptFor(isPodcast: boolean): string {
  const exts = isPodcast
    ? SUPPORTED_AUDIO
    : [...SUPPORTED_AUDIO, ...SUPPORTED_EBOOK]
  return exts.map((e) => '.' + e).join(',')
}

export interface UploadItemPayload {
  libraryId: string
  folderId: string
  title: string
  author?: string | null
  series?: string | null
  isPodcast: boolean
  files: File[]
}

// POST {serverUrl}/api/upload (multipart). ABS reads files off
// `Object.values(req.files)`, so they're appended under numeric keys 0,1,2...
// exactly as the ABS web client does. `fetch` can't report upload progress, so
// this uses XHR for the byte callback; auth rides as an Authorization header
// built from the active server's in-memory ABS token.
export function uploadItem(
  target: AbsTarget,
  payload: UploadItemPayload,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const token = getAbsToken(target.serverId)
  const form = new FormData()
  form.set('title', payload.title)
  if (!payload.isPodcast) {
    form.set('author', payload.author || '')
    form.set('series', payload.series || '')
  }
  form.set('library', payload.libraryId)
  form.set('folder', payload.folderId)
  payload.files.forEach((file, i) => form.set(String(i), file))

  const url = `${target.serverUrl.replace(/\/$/, '')}/api/upload`

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(form)
  })
}
