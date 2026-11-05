import { useRef, useState, type CSSProperties } from 'react'
import { checkFolderExists } from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { SelectField } from '@/components/common/SelectField'

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
// browse proxy). A missing path blocks Create, because ABS silently creates it and a
// typo would become an empty folder. "unknown" is allowed: web can't always check.
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

  // Bumped on every edit, so an answer about an older path is dropped.
  const pathEdits = useRef(0)

  const checkPath = async () => {
    const p = fullPath.trim()
    if (!p) {
      setPathState('idle')
      return 'idle'
    }
    const edit = pathEdits.current
    setPathState('checking')
    const result = await checkFolderExists(target, p)
    if (edit !== pathEdits.current) return 'idle'
    setPathState(result)
    return result
  }

  const canSubmit =
    Boolean(name.trim() && fullPath.trim()) &&
    !busy &&
    pathState !== 'checking' &&
    pathState !== 'missing'

  const submit = async () => {
    if (!canSubmit) return
    const state = pathState === 'idle' ? await checkPath() : pathState
    if (state === 'missing' || state === 'idle') return
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
          <button className="btn-sm btn-green" disabled={!canSubmit} onClick={() => void submit()}>
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
        <SelectField
          value={mediaType}
          onChange={(next) => setMediaType(next as 'book' | 'podcast')}
          options={[
            { value: 'book', label: 'Books' },
            { value: 'podcast', label: 'Podcasts' },
          ]}
        />
      </div>

      <div className="field full">
        <label>Folder</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            className="fld"
            style={{ flex: 1 }}
            value={fullPath}
            onChange={(e) => {
              pathEdits.current++
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
            Fix the path to create the library.
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
