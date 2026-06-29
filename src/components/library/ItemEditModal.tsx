import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  updateItemMetadata,
  deleteItemFile,
  reorderItemTracks,
  embedItemMetadata,
  itemFileDownloadUrl,
  itemDownloadUrl,
  type BookDetailFull,
  type BookAudioFile,
  type ItemMetadataPatch,
} from '@/api/absBookDetail'
import type { AbsTarget } from '@/api/absLibrary'
import { formatTimestamp } from '@/lib/format'
import { Modal } from '@/components/common/Modal'
import { Chips } from '@/components/common/Chips'
import { Icon } from '@/components/common/Icon'
import { ChapterEditorModal, type EditableChapter } from '@/components/library/ChapterEditorModal'

function Field({
  label,
  full,
  children,
}: {
  label: string
  full?: boolean
  children: ReactNode
}) {
  return (
    <div className={'field' + (full ? ' full' : '')}>
      <label>{label}</label>
      {children}
    </div>
  )
}

interface ItemEditModalProps {
  target: AbsTarget
  item: BookDetailFull
  chapters: EditableChapter[]
  onClose: () => void
}

// Editing modal. Details saves metadata via PATCH /api/items/:id/media; Chapters
// opens the chapter editor (POST /api/items/:id/chapters); Files downloads/deletes
// and reorders individual files; Tools embeds metadata back into the audio
// (POST /api/tools/item/:id/embed-metadata).
export function ItemEditModal({ target, item, chapters, onClose }: ItemEditModalProps) {
  const qc = useQueryClient()
  const hasAudio = item.audioFiles.length > 0

  const [tab, setTab] = useState('Details')
  const [editingChapters, setEditingChapters] = useState(false)
  const [title, setTitle] = useState(item.title ?? '')
  const [subtitle, setSubtitle] = useState(item.subtitle ?? '')
  const [publishedYear, setPublishedYear] = useState(item.publishedYear ?? '')
  const [publisher, setPublisher] = useState(item.publisher ?? '')
  const [isbn, setIsbn] = useState(item.isbn ?? '')
  const [asin, setAsin] = useState(item.asin ?? '')
  const [genres, setGenres] = useState<string[]>(item.genres ?? [])
  const [tags, setTags] = useState<string[]>(item.tags ?? [])
  const [description, setDescription] = useState(item.description ?? '')
  const [abridged, setAbridged] = useState(Boolean(item.abridged))
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['abs-book-detail', target.serverId, item.id] })
    qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, item.id] })
  }

  const save = async (thenClose: boolean) => {
    setSaving(true)
    const patch: ItemMetadataPatch = {
      title,
      subtitle,
      description,
      publishedYear,
      publisher,
      isbn,
      asin,
      genres,
      abridged,
    }
    try {
      await updateItemMetadata(target, item.id, patch, tags)
      invalidate()
      if (thenClose) onClose()
      else setSavedNote('Saved')
    } finally {
      setSaving(false)
    }
  }

  const foot = (
    <>
      <div className="spacer" style={{ flex: 1 }} />
      {savedNote && (
        <span style={{ color: '#a7c896', fontSize: 13, marginRight: 8 }}>
          <Icon name="check" /> {savedNote}
        </span>
      )}
      <button className="btn-sm btn-ghost" disabled={saving} onClick={() => void save(false)}>
        Save
      </button>
      <button className="btn-sm btn-green" disabled={saving} onClick={() => void save(true)}>
        <Icon name="save" /> Save &amp; close
      </button>
    </>
  )

  return (
    <>
      <Modal
        title={`Edit · ${title}`}
        onClose={onClose}
        tabs={['Details', ...(hasAudio ? ['Chapters', 'Files', 'Tools'] : [])]}
        tab={tab}
        setTab={setTab}
        foot={tab === 'Details' ? foot : undefined}
      >
        {tab === 'Chapters' && (
          <ChaptersTab chapterCount={chapters.length} onEdit={() => setEditingChapters(true)} />
        )}
        {tab === 'Files' && <FilesTab target={target} item={item} onChanged={invalidate} />}
        {tab === 'Tools' && <ToolsTab target={target} itemId={item.id} />}
        {tab === 'Details' && (
          <div className="form-grid">
            <Field label="Title" full>
              <input className="fld" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Subtitle" full>
              <input className="fld" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            </Field>
            <Field label="Publish year">
              <input
                className="fld"
                value={publishedYear}
                onChange={(e) => setPublishedYear(e.target.value)}
              />
            </Field>
            <Field label="Publisher">
              <input className="fld" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </Field>
            <Field label="ISBN">
              <input className="fld" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
            </Field>
            <Field label="ASIN">
              <input className="fld" value={asin} onChange={(e) => setAsin(e.target.value)} />
            </Field>
            <Field label="Genres">
              <Chips items={genres} onChange={setGenres} placeholder="Add genre…" />
            </Field>
            <Field label="Tags" full>
              <Chips items={tags} onChange={setTags} placeholder="Add tag…" />
            </Field>
            <Field label="Description" full>
              <textarea
                className="fld"
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="field-row" style={{ borderTop: 'none' }}>
              <div className="fr-meta">
                <div className="fr-t">Abridged</div>
              </div>
              <div
                className={'toggle' + (abridged ? ' on' : '')}
                role="switch"
                aria-checked={abridged}
                onClick={() => setAbridged((v) => !v)}
              >
                <i />
              </div>
            </div>
          </div>
        )}
      </Modal>
      {editingChapters && (
        <ChapterEditorModal
          target={target}
          itemId={item.id}
          chapters={chapters}
          duration={item.durationSec}
          onClose={() => {
            setEditingChapters(false)
            invalidate()
          }}
        />
      )}
    </>
  )
}

function ChaptersTab({ chapterCount, onEdit }: { chapterCount: number; onEdit: () => void }) {
  return (
    <div style={{ padding: '8px 2px' }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        This book has {chapterCount} {chapterCount === 1 ? 'chapter' : 'chapters'}. Open the chapter
        editor to rename them or adjust their start times.
      </p>
      <button className="btn-sm btn-green" style={{ marginTop: 12 }} onClick={onEdit}>
        <Icon name="edit" /> Edit chapters
      </button>
    </div>
  )
}

function FilesTab({
  target,
  item,
  onChanged,
}: {
  target: AbsTarget
  item: BookDetailFull
  onChanged: () => void
}) {
  const [files, setFiles] = useState<BookAudioFile[]>(item.audioFiles)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const downloadAll = itemDownloadUrl(target, item.id)

  const remove = async (ino: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? The file is removed from disk.`)) return
    setDeleting(ino)
    try {
      await deleteItemFile(target, item.id, ino)
      setFiles((cur) => cur.filter((f) => f.ino !== ino))
      onChanged()
    } finally {
      setDeleting(null)
    }
  }

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...files]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setFiles(next)
    setSavingOrder(true)
    try {
      await reorderItemTracks(
        target,
        item.id,
        next.map((f) => f.ino)
      )
      onChanged()
    } finally {
      setSavingOrder(false)
    }
  }

  const canReorder = files.length > 1

  return (
    <div className="tbl-wrap">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        {downloadAll && (
          <a className="btn-sm" href={downloadAll} target="_blank" rel="noreferrer">
            <Icon name="download" /> Download all
          </a>
        )}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>File</th>
            <th>Length</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => {
            const dl = itemFileDownloadUrl(target, item.id, f.ino)
            return (
              <tr key={f.ino}>
                <td style={{ fontWeight: 600 }}>{f.filename}</td>
                <td className="mono">{formatTimestamp(f.durationSec)}</td>
                <td>
                  <div className="t-actions">
                    {canReorder && (
                      <>
                        <button
                          className="tbl-icon"
                          title="Move up"
                          disabled={i === 0 || savingOrder}
                          onClick={() => void move(i, -1)}
                        >
                          <Icon name="arrow_upward" />
                        </button>
                        <button
                          className="tbl-icon"
                          title="Move down"
                          disabled={i === files.length - 1 || savingOrder}
                          onClick={() => void move(i, 1)}
                        >
                          <Icon name="arrow_downward" />
                        </button>
                      </>
                    )}
                    {dl && (
                      <a
                        className="tbl-icon"
                        title="Download file"
                        href={dl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="download" />
                      </a>
                    )}
                    <button
                      className="tbl-icon"
                      title="Delete file"
                      disabled={deleting === f.ino}
                      onClick={() => void remove(f.ino, f.filename)}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ToolsTab({ target, itemId }: { target: AbsTarget; itemId: string }) {
  const [chapters, setChapters] = useState(false)
  const [backup, setBackup] = useState(true)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const embed = async () => {
    setRunning(true)
    setMsg(null)
    try {
      await embedItemMetadata(target, itemId, { forceEmbedChapters: chapters, backup })
      setMsg('Started - the server is embedding metadata in the background.')
    } catch {
      setMsg('Could not start. The item may already be queued or processing.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ padding: '8px 2px' }}>
      <div className="section-head">
        <Icon name="save_as" />
        <h2>Embed metadata</h2>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Write the current title, author, and cover back into the audio files so other players read
        them too. Runs as a background task.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 14 }}>
        <input type="checkbox" checked={chapters} onChange={(e) => setChapters(e.target.checked)} />
        Also embed chapter markers
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 14 }}>
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        Keep a backup of the original files
      </label>
      <button
        className="btn-sm btn-green"
        style={{ marginTop: 16 }}
        disabled={running}
        onClick={() => void embed()}
      >
        <Icon name="save_as" /> {running ? 'Starting...' : 'Embed metadata'}
      </button>
      {msg && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{msg}</p>}
    </div>
  )
}
