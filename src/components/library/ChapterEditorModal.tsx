import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { updateItemChapters } from '@/api/absBookDetail'
import type { AbsTarget } from '@/api/absLibrary'
import { formatTimestamp } from '@hearthshelf/core'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'

export interface EditableChapter {
  title: string
  start: number
  end: number
}

interface ChapterEditorModalProps {
  target: AbsTarget
  itemId: string
  chapters: EditableChapter[]
  duration: number
  onClose: () => void
}

// Edit chapter titles and start times, add/remove chapters. End times are
// derived from the next chapter's start (last chapter ends at the duration).
export function ChapterEditorModal({
  target,
  itemId,
  chapters,
  duration,
  onClose,
}: ChapterEditorModalProps) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<EditableChapter[]>(
    chapters.map((c) => ({ title: c.title, start: c.start, end: c.end }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setTitle = (i: number, title: string) =>
    setRows((r) => r.map((c, j) => (j === i ? { ...c, title } : c)))
  const setStart = (i: number, mmss: string) => {
    // accept H:MM:SS or M:SS or raw seconds
    const parts = mmss.split(':').map(Number)
    let sec = 0
    if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
    else if (parts.length === 2) sec = parts[0] * 60 + parts[1]
    else sec = parts[0] || 0
    setRows((r) => r.map((c, j) => (j === i ? { ...c, start: sec } : c)))
  }
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i))
  const addRow = () =>
    setRows((r) => [
      ...r,
      { title: `Chapter ${r.length + 1}`, start: r[r.length - 1]?.end ?? 0, end: duration },
    ])

  const save = async () => {
    setError(null)
    const sorted = [...rows].filter((c) => c.title.trim()).sort((a, b) => a.start - b.start)
    if (sorted.length === 0) {
      setError('At least one chapter is required.')
      return
    }
    const finalized = sorted.map((c, i) => ({
      title: c.title.trim(),
      start: c.start,
      end: i < sorted.length - 1 ? sorted[i + 1].start : duration,
    }))
    setSaving(true)
    try {
      await updateItemChapters(target, itemId, finalized)
      qc.invalidateQueries({ queryKey: ['abs-book-detail', target.serverId, itemId] })
      qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, itemId] })
      onClose()
    } catch {
      setError('Could not save chapters.')
    } finally {
      setSaving(false)
    }
  }

  const foot = (
    <>
      <button className="btn-sm btn-ghost" onClick={addRow}>
        <Icon name="add" /> Add chapter
      </button>
      {error && <span style={{ color: 'var(--primary)', fontSize: 13 }}>{error}</span>}
      <div style={{ flex: 1 }} />
      <button className="btn-sm btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button className="btn-sm btn-green" disabled={saving} onClick={() => void save()}>
        <Icon name="save" /> Save chapters
      </button>
    </>
  )

  return (
    <Modal title="Edit chapters" onClose={onClose} foot={foot}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              className="num"
              style={{ width: 22, color: 'var(--text-faint)', textAlign: 'right' }}
            >
              {i + 1}
            </span>
            <input
              className="fld"
              style={{ flex: 1 }}
              value={c.title}
              onChange={(e) => setTitle(i, e.target.value)}
            />
            <input
              className="fld"
              style={{ width: 96, fontFamily: 'var(--font-mono)', textAlign: 'right' }}
              defaultValue={formatTimestamp(c.start)}
              onBlur={(e) => setStart(i, e.target.value)}
            />
            <button className="tbl-icon" title="Remove" onClick={() => removeRow(i)}>
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
