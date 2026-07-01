import { useState } from 'react'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Icon } from '@/components/common/Icon'

interface CoverProps {
  itemId: string
  title: string
  author?: string
  kicker?: string
  finished?: boolean
  /** Scales the typeset-fallback internals (design convention). */
  fs?: number
  /** Cover image request width (px). */
  width?: number
  className?: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
  overlay?: React.ReactNode
}

// Warm fallback tints, picked deterministically from the title so each book's
// typeset placeholder is stable and distinct (real cover art always wins).
const FALLBACK_TINTS = [
  '#3f7d8c',
  '#c4663a',
  '#5e76c4',
  '#4f9db0',
  '#b85c4a',
  '#7fa86b',
  '#9b6fb8',
  '#2f9d8f',
  '#b07a3c',
  '#c8487e',
]

export function tintFor(title: string): string {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return FALLBACK_TINTS[h % FALLBACK_TINTS.length]
}

/**
 * The design's signature cover for the WebApp: real ABS artwork when it loads,
 * otherwise a typeset duotone placeholder. Image source comes from the ambient
 * MediaUI provider (per-server, auth-tokenized) so this stays free of any direct
 * data-layer or auth wiring - same markup/classes as the self-hosted app.
 */
export function Cover({
  itemId,
  title,
  author,
  kicker,
  finished,
  fs = 14,
  width = 240,
  className,
  style,
  onClick,
  overlay,
}: CoverProps) {
  const ui = useMediaUI()
  const src = ui.coverUrl(itemId, width)
  const [imgOk, setImgOk] = useState(Boolean(src))

  const tint = tintFor(title)
  const initial = (title || '?').trim()[0]

  return (
    <div
      className={'cover' + (imgOk ? ' has-img' : '') + (className ? ' ' + className : '')}
      onClick={onClick}
      style={{
        ['--cv' as string]: tint,
        ['--cv-bg' as string]: tint,
        fontSize: fs + 'px',
        ...style,
      }}
    >
      {imgOk && src && (
        <img
          className="cv-img"
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      )}
      <span className="cv-mono" aria-hidden>
        {initial}
      </span>
      <div className="cv-body">
        <div className="cv-rule" />
        {kicker && <div className="cv-kicker">{kicker}</div>}
        <div className="cv-title">{title}</div>
        {author && <div className="cv-author">{author}</div>}
      </div>
      <span className="cv-shine" />
      {finished && (
        <span className="cover-badge">
          <Icon name="check" fill />
        </span>
      )}
      {overlay}
    </div>
  )
}
