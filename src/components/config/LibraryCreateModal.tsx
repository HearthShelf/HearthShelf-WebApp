import { useState, type CSSProperties } from 'react'
import { checkFolderExists } from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

const ERR_STYLE: CSSProperties = {
  fontSize: 13,
  color: '#e8897f',
  background: 'color-mix(in oklab, #d8443a 14%, transparent)',
  border: '1px solid color-mix(in oklab, #d8443a 40%, transparent)',
  borderRadius: 10,
  padding: '8px 12px',
  margin: '0 0 14px',
}

export interface LibraryCreateValues {
  name: string
  mediaType: 'book' | 'podcast'
  fullPath: string
}

interface LibraryCreateModalProps {
  target: AbsTarget
  busy?: boolean
  error?: string | null
  onCreate: (values: LibraryCreateValues) => void
  onClose: () => void
}

// Create a new ABS library: name, media type, and a single root folder. ABS has
// a /api/filesystem endpoint behind checkFolderExists, so the folder field gets a
// live "exists / missing" check (the WebApp talks straight to ABS, no folder-tree
// browse proxy), but a plain typed path is still accepted on submit.
export function LibraryCreateModal({
  target,
  busy,
  error,
  onCreate,
  onClose,
}: LibraryCreateModalProps) {
  const [name, setName] = useState('')
  const [mediaType, setMediaType] = useState<'book' | 'podcast'>('book')
  const [fullPath, setFullPath] = useState('')
  const [pathState, setPathState] = useState<
    'idle' | 'checking' | 'exists' | 'missing' | 'unknown'
  >('idle')

  const checkPath = async () => {
    const p = fullPath.trim()
    if (!p) {
      setPathState('idle')
      return
    }
    setPathState('checking')
    setPathState(await checkFolderExists(target, p))
  }

  const canSubmit = Boolean(name.trim() && fullPath.trim()) && !busy

  const submit = () => {
    if (!canSubmit) return
    onCreate({ name: name.trim(), mediaType, fullPath: fullPath.trim() })
  }

  return (
    <Modal
      title="New library"
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-sm btn-green" disabled={!canSubmit} onClick={submit}>
            <Icon name="add" /> {busy ? 'Creating...' : 'Create library'}
          </button>
        </>
      }
    >
      {error && <div style={ERR_STYLE}>{error}</div>}

      <div className="field full">
        <label>Name</label>
        <input
          className="fld"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Audiobooks"
        />
      </div>

      <div className="field full">
        <label>Media type</label>
        <select
          className="fld"
          value={mediaType}
          onChange={(e) => setMediaType(e.target.value as 'book' | 'podcast')}
        >
          <option value="book">Books</option>
          <option value="podcast">Podcasts</option>
        </select>
      </div>

      <div className="field full">
        <label>Folder</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            className="fld"
            style={{ flex: 1 }}
            value={fullPath}
            onChange={(e) => {
              setFullPath(e.target.value)
              setPathState('idle')
            }}
            onBlur={() => void checkPath()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void checkPath()
            }}
            placeholder="/audiobooks"
          />
          <button
            className="btn-sm btn-ghost"
            type="button"
            disabled={!fullPath.trim() || pathState === 'checking'}
            onClick={() => void checkPath()}
          >
            <Icon name="search" /> Check
          </button>
        </div>
        {pathState === 'exists' && (
          <p className="hint" style={{ margin: '4px 2px 0', fontSize: 12, color: '#a7c896' }}>
            <Icon name="check_circle" style={{ verticalAlign: '-3px' }} /> Folder found on the
            server.
          </p>
        )}
        {pathState === 'missing' && (
          <p className="hint" style={{ margin: '4px 2px 0', fontSize: 12, color: '#e8897f' }}>
            <Icon name="error" style={{ verticalAlign: '-3px' }} /> Folder not found on the server.
            You can still create the library, but it has nothing to scan.
          </p>
        )}
        {(pathState === 'idle' || pathState === 'checking' || pathState === 'unknown') && (
          <p className="hint" style={{ margin: '4px 2px 0', fontSize: 12 }}>
            An absolute path on the server, inside the AudiobookShelf container (e.g.{' '}
            <code>/audiobooks</code>).
          </p>
        )}
      </div>
    </Modal>
  )
}
