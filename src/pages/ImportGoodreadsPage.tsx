import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { Icon } from '@/components/common/Icon'
import { parseGoodreadsCsv, isReadRow, type GoodreadsRow } from '@/lib/goodreadsCsv'
import {
  finishedBooksKeys,
  importRows,
  matchRows,
  type ImportRow,
  type MatchRow,
} from '@/api/finishedBooks'

interface ReviewRow extends GoodreadsRow {
  status: MatchRow['status']
  candidates: MatchRow['candidates']
  resolvedLibraryItemId: string | null
  resolved: boolean
}

export function ImportGoodreadsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { target, libraries, activeId, select } = useActiveLibrary()
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [matching, setMatching] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const unresolvedCount = useMemo(() => rows?.filter((r) => !r.resolved).length ?? 0, [rows])

  const handleFile = async (file: File) => {
    setRows(null)
    setMessage(null)
    if (!target || !activeId) {
      setMessage('No library selected')
      return
    }
    setMatching(true)
    try {
      const readRows = (await parseGoodreadsCsv(file)).filter(isReadRow)
      const { matches } = await matchRows(
        target,
        activeId,
        readRows.map((r) => ({ title: r.title, author: r.author, isbn: r.isbn ?? r.isbn13 })),
      )
      setRows(
        readRows.map((r, i) => {
          const m = matches[i]
          const auto = m.status === 'auto' ? (m.candidates[0]?.libraryItemId ?? null) : null
          return {
            ...r,
            status: m.status,
            candidates: m.candidates,
            resolvedLibraryItemId: auto,
            resolved: m.status !== 'ambiguous',
          }
        }),
      )
      setMessage(`Found ${readRows.length} read book${readRows.length === 1 ? '' : 's'}.`)
    } catch {
      setMessage('Could not parse or match that CSV.')
    } finally {
      setMatching(false)
    }
  }

  const resolveRow = (index: number, libraryItemId: string | null) =>
    setRows((cur) =>
      cur
        ? cur.map((r, i) =>
            i === index ? { ...r, resolvedLibraryItemId: libraryItemId, resolved: true } : r,
          )
        : cur,
    )
  const stubAllUnresolved = () =>
    setRows((cur) =>
      cur
        ? cur.map((r) => (!r.resolved ? { ...r, resolvedLibraryItemId: null, resolved: true } : r))
        : cur,
    )

  const commit = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('no target')
      const reviewed: ImportRow[] = (rows ?? []).map((r) => ({
        title: r.title,
        author: r.author || null,
        isbn: r.isbn ?? r.isbn13,
        dateFinished: r.dateFinished,
        rating: r.rating,
        libraryItemId: r.resolvedLibraryItemId,
      }))
      return importRows(target, reviewed)
    },
    onSuccess: (result) => {
      if (target) qc.invalidateQueries({ queryKey: finishedBooksKeys.list(target.serverId) })
      setRows(null)
      setMessage(`Imported ${result.inserted + result.updated} books`)
    },
    onError: () => setMessage('Import failed - try again'),
  })

  return (
    <div className="page fade-in">
      <div className="page-head">
        <button className="btn-sm" onClick={() => navigate('/account/settings')}>
          <Icon name="arrow_back" /> Settings
        </button>
        <div className="eyebrow">Reading history</div>
        <h1 className="title-xl">Import from Goodreads</h1>
        <p className="page-sub">
          Export your library from Goodreads, then upload the CSV here. Only books marked read are
          imported.
        </p>
      </div>

      {!rows && (
        <div className="cfg-card">
          {libraries.length > 1 && (
            <div className="field full">
              <label>Library to match against</label>
              <select
                className="fld"
                value={activeId ?? ''}
                onChange={(e) => select(e.target.value)}
              >
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field full">
            <label>Goodreads export CSV</label>
            <input
              className="fld"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </div>
          {matching && <div className="p-toast">Matching against your library...</div>}
          {message && <div className="p-toast">{message}</div>}
        </div>
      )}

      {rows && (
        <>
          <div className="cfg-card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="cl-d">
              {rows.length} read book{rows.length === 1 ? '' : 's'} found.{' '}
              {unresolvedCount > 0
                ? `${unresolvedCount} need a decision before import.`
                : 'Ready to import.'}
            </div>
            {unresolvedCount > 0 && (
              <button
                className="btn-sm"
                style={{ marginTop: 'var(--s3)' }}
                onClick={stubAllUnresolved}
              >
                Save unresolved as history only
              </button>
            )}
          </div>
          <div className="cfg-card">
            {rows.map((r, i) => (
              <div className="cfg-line" key={`${r.title}-${i}`}>
                <Icon
                  name={r.resolvedLibraryItemId ? 'check_circle' : 'help'}
                  fill={Boolean(r.resolvedLibraryItemId)}
                  style={{ color: r.resolvedLibraryItemId ? '#5a9c52' : 'var(--text-muted)' }}
                />
                <div className="cl-meta" style={{ flex: 1 }}>
                  <div className="cl-t">{r.title}</div>
                  <div className="cl-d">
                    {r.author} {r.dateFinished ? `- read ${r.dateFinished}` : ''}
                  </div>
                </div>
                {r.status === 'ambiguous' && !r.resolved ? (
                  <select
                    className="fld"
                    style={{ maxWidth: 280 }}
                    value=""
                    onChange={(e) => resolveRow(i, e.target.value || null)}
                  >
                    <option value="">Pick a match...</option>
                    {r.candidates.map((c) => (
                      <option key={c.libraryItemId} value={c.libraryItemId}>
                        {c.title} - {c.author}
                      </option>
                    ))}
                    <option value="">None of these</option>
                  </select>
                ) : (
                  <span className="badge-pill">
                    {r.resolvedLibraryItemId ? 'Matched' : 'History only'}
                  </span>
                )}
              </div>
            ))}
          </div>
          <button
            className="btn-sm btn-green"
            style={{ marginTop: 'var(--s4)' }}
            disabled={unresolvedCount > 0 || commit.isPending}
            onClick={() => commit.mutate()}
          >
            <Icon name="save" /> Confirm &amp; import
          </button>
          {message && <div className="p-toast">{message}</div>}
        </>
      )}
    </div>
  )
}
