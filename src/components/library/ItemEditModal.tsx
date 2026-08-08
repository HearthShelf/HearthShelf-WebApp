import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  updateItemMetadata,
  getBookDetailFull,
  getLibraryFilterData,
  deleteItemFile,
  reorderItemTracks,
  embedItemMetadata,
  itemFileDownloadUrl,
  itemDownloadUrl,
  type BookDetailFull,
  type BookAudioFile,
  type ItemMetadataPatch,
  type ItemSeriesPatch,
} from '@/api/absBookDetail'
import type { AbsTarget } from '@/api/absLibrary'
import { formatTimestamp } from '@hearthshelf/core'
import { Modal } from '@/components/common/Modal'
import { SuggestChips } from '@/components/common/SuggestChips'
import { SeriesEditor } from '@/components/library/SeriesEditor'
import { Icon } from '@/components/common/Icon'
import { ItemMatchTab } from '@/components/library/ItemMatchTab'
import { ItemCoverTab } from '@/components/library/ItemCoverTab'
import { ChapterEditorModal, type EditableChapter } from '@/components/library/ChapterEditorModal'

function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <div className={'field' + (full ? ' full' : '')}>
      <label>{label}</label>
      {children}
    </div>
  )
}

interface EditForm {
  title: string
  subtitle: string
  publishedYear: string
  publishedDate: string
  publisher: string
  isbn: string
  asin: string
  language: string
  genres: string[]
  tags: string[]
  description: string
  explicit: boolean
  abridged: boolean
  authors: string[]
  narrators: string[]
  series: ItemSeriesPatch[]
}

// Every editable field, straight off the item. Used both to seed the form and to
// reseed it after a provider match rewrites the item server-side.
function seedForm(item: BookDetailFull): EditForm {
  return {
    title: item.title ?? '',
    subtitle: item.subtitle ?? '',
    publishedYear: item.publishedYear ?? '',
    publishedDate: item.publishedDate ?? '',
    publisher: item.publisher ?? '',
    isbn: item.isbn ?? '',
    asin: item.asin ?? '',
    language: item.language ?? '',
    genres: item.genres ?? [],
    tags: item.tags ?? [],
    description: item.description ?? '',
    explicit: Boolean(item.explicit),
    abridged: Boolean(item.abridged),
    authors: item.allAuthors ?? [],
    narrators: item.allNarrators ?? [],
    series: (item.allSeries ?? []).map((s) => ({ name: s.name, sequence: s.sequence })),
  }
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
  const [appliedNote, setAppliedNote] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>(() => seedForm(item))
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const {
    title,
    subtitle,
    publishedYear,
    publishedDate,
    publisher,
    isbn,
    asin,
    language,
    genres,
    tags,
    description,
    explicit,
    abridged,
    authors,
    narrators,
    series,
  } = form

  // One setter per field keeps the JSX below unchanged from plain useState.
  const set = <K extends keyof EditForm>(key: K) => {
    return (value: EditForm[K] | ((cur: EditForm[K]) => EditForm[K])) =>
      setForm((cur) => ({
        ...cur,
        [key]: typeof value === 'function' ? (value as (c: EditForm[K]) => EditForm[K])(cur[key]) : value,
      }))
  }

  // Existing library values for type-ahead. Optional - the form works without.
  const { data: filterData } = useQuery({
    queryKey: ['abs-filterdata', target.serverId, item.libraryId],
    queryFn: () => getLibraryFilterData(target, item.libraryId),
    enabled: Boolean(item.libraryId),
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['abs-book-detail', target.serverId, item.id] })
    qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, item.id] })
  }

  const save = async (thenClose: boolean) => {
    setSaving(true)
    // Series, authors and narrators are REPLACE on ABS's side - it unlinks
    // anything absent from these arrays - so always send the complete list the
    // form is showing, never a delta.
    const patch: ItemMetadataPatch = {
      title,
      subtitle,
      description,
      publishedYear,
      publishedDate,
      publisher,
      language,
      isbn,
      asin,
      genres,
      narrators,
      series,
      authors: authors.map((name) => ({ name })),
      explicit,
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

  // A provider match/cover was applied. The tab already awaited the refetch, so
  // the rewritten item is in cache - reseed the form from it and show Details
  // with the new values already filled in.
  const onApplied = async (msg: string) => {
    const fresh = await qc.fetchQuery({
      queryKey: ['abs-book-detail', target.serverId, item.id],
      queryFn: () => getBookDetailFull(target, item.id),
    })
    if (fresh) setForm(seedForm(fresh))
    setAppliedNote(msg)
    setTab('Details')
  }

  return (
    <>
      <Modal
        title={`Edit · ${title}`}
        onClose={onClose}
        tabs={['Details', 'Cover', ...(hasAudio ? ['Chapters', 'Files', 'Tools'] : []), 'Match']}
        tab={tab}
        setTab={setTab}
        foot={tab === 'Details' ? foot : undefined}
      >
        {tab === 'Match' && (
          <ItemMatchTab
            target={target}
            itemId={item.id}
            defaultTitle={title}
            defaultAuthor={item.author}
            onApplied={onApplied}
          />
        )}
        {tab === 'Cover' && (
          <ItemCoverTab
            target={target}
            itemId={item.id}
            defaultTitle={title}
            defaultAuthor={item.author}
            onApplied={onApplied}
          />
        )}
        {tab === 'Chapters' && (
          <ChaptersTab chapterCount={chapters.length} onEdit={() => setEditingChapters(true)} />
        )}
        {tab === 'Files' && <FilesTab target={target} item={item} onChanged={invalidate} />}
        {tab === 'Tools' && <ToolsTab target={target} itemId={item.id} />}
        {tab === 'Details' && (
          <div className="form-grid">
            {appliedNote && (
              <div className="field full">
                <span style={{ color: '#a7c896', fontSize: 13 }}>
                  <Icon name="check" /> {appliedNote}
                </span>
              </div>
            )}
            <Field label="Title" full>
              <input className="fld" value={title} onChange={(e) => set('title')(e.target.value)} />
            </Field>
            <Field label="Subtitle" full>
              <input
                className="fld"
                value={subtitle}
                onChange={(e) => set('subtitle')(e.target.value)}
              />
            </Field>
            <Field label="Authors" full>
              <SuggestChips
                items={authors}
                onChange={set('authors')}
                suggestions={(filterData?.authors ?? []).map((a) => a.name)}
                placeholder="Add author…"
              />
            </Field>
            <Field label="Series" full>
              <SeriesEditor
                series={series}
                onChange={set('series')}
                suggestions={(filterData?.series ?? []).map((s) => s.name)}
              />
            </Field>
            <Field label="Narrators" full>
              <SuggestChips
                items={narrators}
                onChange={set('narrators')}
                suggestions={filterData?.narrators ?? []}
                placeholder="Add narrator…"
              />
            </Field>
            <Field label="Publish year">
              <input
                className="fld"
                value={publishedYear}
                onChange={(e) => set('publishedYear')(e.target.value)}
              />
            </Field>
            <Field label="Publish date">
              <input
                className="fld"
                type="date"
                value={publishedDate}
                onChange={(e) => set('publishedDate')(e.target.value)}
              />
            </Field>
            <Field label="Publisher">
              <input
                className="fld"
                value={publisher}
                onChange={(e) => set('publisher')(e.target.value)}
              />
            </Field>
            <Field label="Language">
              <input
                className="fld"
                value={language}
                onChange={(e) => set('language')(e.target.value)}
              />
            </Field>
            <Field label="ISBN">
              <input className="fld" value={isbn} onChange={(e) => set('isbn')(e.target.value)} />
            </Field>
            <Field label="ASIN">
              <input className="fld" value={asin} onChange={(e) => set('asin')(e.target.value)} />
            </Field>
            <Field label="Genres">
              <SuggestChips
                items={genres}
                onChange={set('genres')}
                suggestions={filterData?.genres ?? []}
                placeholder="Add genre…"
              />
            </Field>
            <Field label="Tags" full>
              <SuggestChips
                items={tags}
                onChange={set('tags')}
                suggestions={filterData?.tags ?? []}
                placeholder="Add tag…"
              />
            </Field>
            <Field label="Description" full>
              <textarea
                className="fld"
                rows={5}
                value={description}
                onChange={(e) => set('description')(e.target.value)}
              />
            </Field>
            <div className="field-row" style={{ borderTop: 'none' }}>
              <div className="fr-meta">
                <div className="fr-t">Explicit</div>
              </div>
              <div
                className={'toggle' + (explicit ? ' on' : '')}
                role="switch"
                aria-checked={explicit}
                onClick={() => set('explicit')((v) => !v)}
              >
                <i />
              </div>
            </div>
            <div className="field-row" style={{ borderTop: 'none' }}>
              <div className="fr-meta">
                <div className="fr-t">Abridged</div>
              </div>
              <div
                className={'toggle' + (abridged ? ' on' : '')}
                role="switch"
                aria-checked={abridged}
                onClick={() => set('abridged')((v) => !v)}
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
        next.map((f) => f.ino),
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
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 14 }}
      >
        <input type="checkbox" checked={chapters} onChange={(e) => setChapters(e.target.checked)} />
        Also embed chapter markers
      </label>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 14 }}
      >
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
