import { useRef, useState } from 'react'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'
import { tintFor } from '@/components/shared/Cover'
import { useActiveServer } from '@/hooks/useActiveServer'
import { absMediaUrl } from '@/api/absClient'
import { matchAuthor, deleteAuthor, uploadAuthorImage } from '@/api/absLibrary'
import { narratorImageUrl, uploadNarratorImage, deleteNarratorImage } from '@/api/absNarratorImages'
import type { Person } from '@/components/library/PersonCard'

interface EditProps {
  person: Person
  saving: boolean
  /** Persist name/description/asin/imageUrl (authors). The narrator path uses
   *  only name (it's a credit string, not a record). */
  onSave: (patch: { name: string; description?: string; asin?: string; imageUrl?: string }) => void
  onClose: () => void
  /** Re-fetch the parent list after an in-modal action (match/upload/delete). */
  onChanged?: () => void
  /** Remove this author/narrator (authors only have a delete record). */
  onDelete?: () => void
  /** Narrators have no ABS record; this flags whether one has a HearthShelf photo
   *  (from /hs/narrators) so the modal can show + offer to remove it. */
  hasImage?: boolean
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

// Rename a person and (authors) edit description / ASIN / photo. Saving a name
// that matches another person in the library merges them, server-side. Authors
// also support a metadata quick-match, web/upload photo, and remove.
export function PersonEditModal({
  person,
  saving,
  onSave,
  onClose,
  onChanged,
  onDelete,
  hasImage,
}: EditProps) {
  const [name, setName] = useState(person.name)
  const [description, setDescription] = useState('')
  const [asin, setAsin] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const isAuthor = person.kind === 'author'

  const { target } = useActiveServer()
  // Bump to cache-bust the <img> after a match/upload swaps the photo.
  const [imgV, setImgV] = useState(0)
  const [busy, setBusy] = useState<null | 'match' | 'upload' | 'delete'>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Narrator photos are removable in-session, so track a local override.
  const [narratorRemoved, setNarratorRemoved] = useState(false)
  const narratorHasPhoto = !isAuthor && Boolean(hasImage) && !narratorRemoved
  const authorHasPhoto = isAuthor && Boolean(person.imagePath)
  const photoSrc = !target
    ? null
    : authorHasPhoto
      ? absMediaUrl(target, `/api/authors/${person.id}/image`) + `&v=${imgV}`
      : narratorHasPhoto
        ? narratorImageUrl(target, person.name, imgV + 1)
        : null

  const dirty =
    (name.trim() !== '' && name !== person.name) ||
    description.trim() !== '' ||
    asin.trim() !== '' ||
    imageUrl.trim() !== ''

  const save = () =>
    onSave({
      name: name.trim(),
      description: isAuthor && description.trim() ? description : undefined,
      asin: isAuthor && asin.trim() ? asin.trim() : undefined,
      imageUrl: isAuthor && imageUrl.trim() ? imageUrl.trim() : undefined,
    })

  // Quick-match against Audible (the ABS "+1") - pulls photo, bio, and ASIN.
  const quickMatch = async () => {
    if (!target) return
    setBusy('match')
    try {
      await matchAuthor(target, person.id, name.trim() || person.name)
      setImgV((v) => v + 1)
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  const pickFile = () => fileRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !target) return
    setBusy('upload')
    try {
      if (isAuthor) {
        await uploadAuthorImage(target, person.id, file)
      } else {
        // Narrators: HearthShelf-native photo store, keyed by name.
        await uploadNarratorImage(target, person.name, file)
        setNarratorRemoved(false)
      }
      setImgV((v) => v + 1)
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  // Remove a narrator's HearthShelf photo (narrators have no record to delete).
  const removeNarratorPhoto = async () => {
    if (!target) return
    setBusy('delete')
    try {
      await deleteNarratorImage(target, person.name)
      setNarratorRemoved(true)
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!target) return
    setBusy('delete')
    try {
      await deleteAuthor(target, person.id)
      onDelete?.()
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title={`Edit ${isAuthor ? 'author' : 'narrator'}`}
      onClose={onClose}
      foot={
        <>
          {isAuthor && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              disabled={busy !== null || saving}
              onClick={remove}
            >
              <Icon name="delete" /> {busy === 'delete' ? 'Removing…' : 'Remove'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="pe-portrait">
        {photoSrc ? (
          <img className="pe-avatar" src={photoSrc} alt={person.name} />
        ) : (
          <span
            className="pe-avatar pe-avatar-fallback"
            style={{ ['--cv' as string]: tintFor(person.name) }}
          >
            {initialsOf(person.name)}
          </span>
        )}
        <div className="pr-d">
          {person.count} {person.count === 1 ? 'book' : 'books'}
        </div>
      </div>

      {isAuthor ? (
        <div
          className="pe-photo-actions"
          style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="btn-sm btn-accent"
            disabled={busy !== null}
            onClick={quickMatch}
            title="Match against Audible (+1): fetch photo, bio, and ASIN"
          >
            <Icon name="auto_fix_high" /> {busy === 'match' ? 'Matching…' : 'Quick match'}
          </button>
          <button
            type="button"
            className="btn-sm btn-ghost"
            disabled={busy !== null}
            onClick={pickFile}
          >
            <Icon name="upload" /> {busy === 'upload' ? 'Uploading…' : 'Upload photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFile}
          />
        </div>
      ) : (
        // Narrators: HearthShelf-native photo (ABS has no narrator record), keyed
        // by name and stored on the server's HS backend.
        <div
          className="pe-photo-actions"
          style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="btn-sm btn-accent"
            disabled={busy !== null}
            onClick={pickFile}
          >
            <Icon name="upload" /> {busy === 'upload' ? 'Uploading…' : 'Upload photo'}
          </button>
          {narratorHasPhoto && (
            <button
              type="button"
              className="btn-sm btn-ghost danger"
              disabled={busy !== null}
              onClick={removeNarratorPhoto}
            >
              <Icon name="delete" /> {busy === 'delete' ? 'Removing…' : 'Remove photo'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFile}
          />
        </div>
      )}

      <label className="fld-label" htmlFor="pe-name">
        Name
      </label>
      <input
        id="pe-name"
        className="fld"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />

      {isAuthor && (
        <>
          <label className="fld-label" htmlFor="pe-desc" style={{ marginTop: 14 }}>
            Description
          </label>
          <textarea
            id="pe-desc"
            className="fld"
            rows={4}
            placeholder="Add a short bio…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ resize: 'vertical' }}
          />

          <label className="fld-label" htmlFor="pe-asin" style={{ marginTop: 14 }}>
            ASIN
          </label>
          <input
            id="pe-asin"
            className="fld"
            value={asin}
            placeholder="e.g. B0BVB123 (links the Audible identity)"
            onChange={(e) => setAsin(e.target.value)}
          />

          <label className="fld-label" htmlFor="pe-img" style={{ marginTop: 14 }}>
            Photo from a web address
          </label>
          <input
            id="pe-img"
            className="fld"
            value={imageUrl}
            placeholder="https://…/photo.jpg (downloaded on save)"
            onChange={(e) => setImageUrl(e.target.value)}
          />
        </>
      )}

      {name.trim() !== '' && name !== person.name && (
        <p className="pr-d" style={{ marginTop: 12 }}>
          If another {isAuthor ? 'author' : 'narrator'} already has this name, they'll be merged.
        </p>
      )}
    </Modal>
  )
}

interface DeleteProps {
  people: Person[]
  deleting: boolean
  onConfirm: () => void
  onClose: () => void
}

// Remove an author record or strip a narrator credit. In both cases the books
// and their files stay - only the credit is removed.
export function PersonDeleteModal({ people, deleting, onConfirm, onClose }: DeleteProps) {
  const isAuthor = people[0]?.kind === 'author'
  const noun = isAuthor ? 'author' : 'narrator'
  const verb = isAuthor ? 'Delete' : 'Remove'

  return (
    <Modal
      title={`${verb} ${people.length} ${people.length === 1 ? noun : noun + 's'}`}
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? 'Working…' : `${verb} ${people.length}`}
          </button>
        </>
      }
    >
      <div className="sso-warn" style={{ marginBottom: 14 }}>
        <Icon name="info" />
        <span>
          {isAuthor ? (
            <>
              This removes the author credit from {people.length === 1 ? 'their' : 'these'} books.
              The <b>books and audio files stay</b> in your library.
            </>
          ) : (
            <>
              This removes the narrator credit from {people.length === 1 ? 'their' : 'these'} books.
              The <b>books and audio files stay</b> in your library.
            </>
          )}
        </span>
      </div>
      <ul className="del-list">
        {people.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <span className="pr-d">
              {p.count} {p.count === 1 ? 'book' : 'books'}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
