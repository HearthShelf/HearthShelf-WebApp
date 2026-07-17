import { useEffect, useState } from 'react'
import { tintFor } from '@/components/shared/Cover'
import { useActiveServer } from '@/hooks/useActiveServer'
import { absMediaUrl } from '@/api/absClient'
import type { AbsLibraryAuthor } from '@/api/absLibrary'

export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (
      (parts[0].match(/[A-Za-z]/)?.[0] ?? '') +
      (parts[parts.length - 1].match(/[A-Za-z]/)?.[0] ?? '')
    ).toUpperCase()
  }
  return (name.match(/[A-Za-z]/g) ?? []).slice(0, 2).join('').toUpperCase()
}

interface AuthorCardProps {
  author: AbsLibraryAuthor
  onOpen: (id: string) => void
}

// Author grid card: real author photo when ABS has one, else a gradient circle
// with initials. Carries data-cv for the cover-glow hover.
export function AuthorCard({ author, onOpen }: AuthorCardProps) {
  const { target } = useActiveServer()
  // Derive photo presence from current props (imagePath can arrive after mount);
  // state tracks only a load failure. See PersonCard for the same reasoning.
  const [imgErr, setImgErr] = useState(false)
  const cv = tintFor(author.name)
  const photoSrc =
    target && author.imagePath ? absMediaUrl(target, `/api/authors/${author.id}/image`) : null
  const imgOk = Boolean(photoSrc) && !imgErr
  useEffect(() => setImgErr(false), [author.id, author.imagePath])

  return (
    <div className="author-card" data-cv={cv} onClick={() => onOpen(author.id)}>
      <div
        className="author-av"
        style={{
          background: `linear-gradient(150deg, ${cv}, color-mix(in oklab, ${cv} 45%, #000))`,
        }}
      >
        {imgOk && photoSrc ? (
          <img
            className="author-photo"
            src={photoSrc}
            alt={author.name}
            onError={() => setImgErr(true)}
          />
        ) : (
          initialsOf(author.name)
        )}
      </div>
      <div className="author-name">{author.name}</div>
      <div className="author-books">
        {author.numBooks} {author.numBooks === 1 ? 'book' : 'books'}
      </div>
    </div>
  )
}
