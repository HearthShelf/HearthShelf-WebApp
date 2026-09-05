import { useEffect, useState } from 'react'
import { coverHue } from '@hearthshelf/core'
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

/**
 * A stable tint for a book, person or series, used by the typeset placeholder
 * and the cover glow when real artwork is missing (real cover art always wins).
 *
 * Delegates to core's `coverHue` so a given seed produces the same colour on
 * every surface - see DESIGN.shared.md, "The One Cover Palette Rule". This was
 * a web-local tint list seeded on the title, which meant the same book rendered
 * one colour here and a different one on mobile.
 *
 * Seeds: books use the item id (matching mobile); people and series, which have
 * no cover item of their own, keep seeding on their name.
 */
export function tintFor(seed: string): string {
  return coverHue(seed)
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

  // The active server/media seam often resolves after the player first
  // renders. Re-arm the image whenever its URL changes instead of leaving a
  // cover that mounted during that brief null state stuck on the fallback.
  useEffect(() => setImgOk(Boolean(src)), [src])

  // Seeded on the item id, not the title, so a book is the same colour here as
  // it is on mobile and in the car (DESIGN.shared.md, "The One Cover Palette
  // Rule"). Falls back to the title for the rare caller with no id.
  const tint = tintFor(itemId || title)
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
