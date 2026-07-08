import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AbsTarget } from '@/api/absLibrary'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useDebounced, useLibrarySearch } from '@/hooks/useLibrary'
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

// Large imports (thousands of rows) go through /match and /import in chunks
// so a single request can't time out a proxy or block the event loop for too
// long. /match re-fetches the whole library per call but is otherwise pure
// in-memory scoring, so it tolerates a bigger batch than /import, which does
// a sequential DB write per row plus an ABS backfill call.
const MATCH_BATCH_SIZE = 500
const IMPORT_BATCH_SIZE = 150

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function GoodreadsImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { target, libraries, activeId, select } = useActiveLibrary()
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [matching, setMatching] = useState(false)
  const [matchProgress, setMatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [message, setMessage] = useState<string | null>(null)
  const [backfillAbs, setBackfillAbs] = useState(true)
  const [hideMatched, setHideMatched] = useState(false)
  const unresolvedCount = useMemo(() => rows?.filter((r) => !r.resolved).length ?? 0, [rows])
  const matchedCount = useMemo(
    () => rows?.filter((r) => r.resolved && r.resolvedLibraryItemId).length ?? 0,
    [rows],
  )
  const visibleRows = useMemo(() => {
    if (!rows) return []
    if (!hideMatched) return rows.map((r, i) => ({ row: r, index: i }))
    return rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(({ row }) => !row.resolved || !row.resolvedLibraryItemId)
  }, [rows, hideMatched])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleFile = async (file: File) => {
    setRows(null)
    setMessage(null)
    if (!target || !activeId) {
      setMessage('No library selected')
      return
    }
    setMatching(true)
    setMatchProgress(null)
    try {
      const readRows = (await parseGoodreadsCsv(file)).filter(isReadRow)
      const batches = chunk(readRows, MATCH_BATCH_SIZE)
      setMatchProgress({ done: 0, total: readRows.length })
      const matches: MatchRow[] = []
      for (const batch of batches) {
        const { matches: batchMatches } = await matchRows(
          target,
          activeId,
          batch.map((r) => ({ title: r.title, author: r.author, isbn: r.isbn ?? r.isbn13 })),
        )
        matches.push(...batchMatches)
        setMatchProgress({ done: matches.length, total: readRows.length })
      }
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
    } catch (err) {
      setMessage(
        err instanceof Error && err.message
          ? `Could not match against your library - ${err.message}`
          : 'Could not parse or match that CSV.',
      )
    } finally {
      setMatching(false)
      setMatchProgress(null)
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
  const editRow = (index: number) =>
    setRows((cur) => (cur ? cur.map((r, i) => (i === index ? { ...r, resolved: false } : r)) : cur))

  const commit = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('no target')
      const reviewed: ImportRow[] = (rows ?? []).map((r) => ({
        title: r.title,
        author: r.author || null,
        isbn: r.isbn ?? r.isbn13,
        dateFinished: r.dateFinished,
        rating: r.rating,
        libraryItemId: r.resolvedLibraryItemId,
      }))
      const batches = chunk(reviewed, IMPORT_BATCH_SIZE)
      setImportProgress({ done: 0, total: reviewed.length })
      let inserted = 0
      let updated = 0
      let absBackfilled = 0
      for (let i = 0; i < batches.length; i++) {
        const isLast = i === batches.length - 1
        // Only ask for the ABS backfill sweep on the last batch - it picks up
        // every unsynced row so far in one shot, no need to run it per chunk.
        const result = await importRows(target, batches[i], isLast && backfillAbs)
        inserted += result.inserted
        updated += result.updated
        absBackfilled += result.absBackfilled ?? 0
        setImportProgress({ done: inserted + updated, total: reviewed.length })
      }
      return { inserted, updated, absBackfilled }
    },
    onSuccess: (result) => {
      if (target) qc.invalidateQueries({ queryKey: finishedBooksKeys.list(target.serverId) })
      setRows(null)
      setImportProgress(null)
      const backfilled = result.absBackfilled ?? 0
      setMessage(
        `Imported ${result.inserted + result.updated} books` +
          (backfilled ? ` - ${backfilled} marked finished in your library` : ''),
      )
    },
    onError: (err) => {
      setImportProgress(null)
      setMessage(`Import failed - ${err instanceof Error ? err.message : 'try again'}`)
    },
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goodreads-import-title"
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={18} />
        </button>

        <div className="mb-1 flex items-center gap-2">
          <Icon name="upload_file" style={{ color: 'var(--text-muted)' }} />
          <h2 id="goodreads-import-title" className="t-h2">
            Import from Goodreads
          </h2>
        </div>
        <p className="t-muted mb-5 text-[13px]">
          Export your library from Goodreads, then upload the CSV here. Only books marked read are
          imported.
        </p>

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
            {matching && (
              <ImportProgressBar
                label="Matching against your library..."
                progress={matchProgress}
              />
            )}
            {message && <div className="p-toast">{message}</div>}
          </div>
        )}

        {rows && (
          <>
            <div className="cfg-card" style={{ marginBottom: 'var(--s4)' }}>
              <div className="cl-d">
                {rows.length} read book{rows.length === 1 ? '' : 's'} found.{' '}
                {unresolvedCount > 0 ? (
                  <strong style={{ color: 'var(--text)' }}>
                    {unresolvedCount} need a decision before you can import.
                  </strong>
                ) : (
                  'Ready to import.'
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
                {unresolvedCount > 0 && (
                  <button className="btn-sm" onClick={stubAllUnresolved}>
                    Save unresolved as history only
                  </button>
                )}
                <label
                  className="btn-sm"
                  style={{ cursor: 'pointer', background: 'var(--fill)' }}
                >
                  <input
                    type="checkbox"
                    checked={hideMatched}
                    onChange={(e) => setHideMatched(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Hide matched
                </label>
              </div>
            </div>
            <div className="cfg-card">
              {visibleRows.length === 0 && (
                <div className="cl-d" style={{ padding: '12px 0' }}>
                  Every book is matched. Uncheck &ldquo;Hide matched&rdquo; to review them.
                </div>
              )}
              {visibleRows.map(({ row: r, index: i }) => (
                <GoodreadsReviewRow
                  key={`${r.title}-${i}`}
                  row={r}
                  target={target}
                  libraryId={activeId}
                  onResolve={(libraryItemId) => resolveRow(i, libraryItemId)}
                  onEdit={() => editRow(i)}
                />
              ))}
            </div>
            <label
              className="cfg-line"
              style={{ gap: 10, marginTop: 'var(--s4)', cursor: 'pointer', alignItems: 'flex-start' }}
            >
              <input
                type="checkbox"
                checked={backfillAbs}
                onChange={(e) => setBackfillAbs(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div className="cl-meta">
                <div className="cl-t">Mark matched books finished in my library</div>
                <div className="cl-d">
                  Sets each matched book&rsquo;s finished date to when you read it, so your reading
                  totals and this-year count fill in on your Stats page.
                  {matchedCount
                    ? ` ${matchedCount} book${matchedCount === 1 ? '' : 's'} will update.`
                    : ''}{' '}
                  Listening time, streaks, and the heatmap can&rsquo;t be filled
                  in&mdash;Goodreads doesn&rsquo;t record how long you listened.
                </div>
              </div>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
              <button
                className="btn-sm btn-green"
                disabled={unresolvedCount > 0 || commit.isPending}
                onClick={() => commit.mutate()}
              >
                <Icon name="save" /> Confirm &amp; import
              </button>
              {unresolvedCount > 0 && !commit.isPending && (
                <span className="cl-d">
                  Resolve or skip the remaining {unresolvedCount} book
                  {unresolvedCount === 1 ? '' : 's'} first, or use &ldquo;Save unresolved as
                  history only&rdquo; above.
                </span>
              )}
            </div>
            {commit.isPending && (
              <ImportProgressBar label="Importing..." progress={importProgress} />
            )}
            {message && <div className="p-toast">{message}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function ImportProgressBar({
  label,
  progress,
}: {
  label: string
  progress: { done: number; total: number } | null
}) {
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0
  return (
    <div className="cfg-card" style={{ marginTop: 'var(--s3)' }}>
      <div className="cl-d" style={{ marginBottom: progress ? 8 : 0 }}>
        {label}
        {progress ? ` (${progress.done}/${progress.total})` : ''}
      </div>
      {progress && (
        <div
          style={{
            height: 6,
            borderRadius: 99,
            background: 'var(--c-highest)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 99,
              background: '#5a9c52',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}
    </div>
  )
}

function GoodreadsReviewRow({
  row: r,
  target,
  libraryId,
  onResolve,
  onEdit,
}: {
  row: ReviewRow
  target: AbsTarget | null
  libraryId: string | null
  onResolve: (libraryItemId: string | null) => void
  onEdit: () => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)
  const searching = !r.resolved && debouncedQuery.trim().length > 0
  const { data: results, isFetching } = useLibrarySearch(
    target as AbsTarget,
    libraryId ?? undefined,
    debouncedQuery,
    searching && Boolean(target),
  )

  const editable = !r.resolved

  return (
    <div className="cfg-line" style={{ flexWrap: 'wrap', alignItems: editable ? 'flex-start' : 'center' }}>
      <Icon
        name={r.resolvedLibraryItemId ? 'check_circle' : 'help'}
        fill={Boolean(r.resolvedLibraryItemId)}
        style={{ color: r.resolvedLibraryItemId ? '#5a9c52' : 'var(--text-muted)', marginTop: editable ? 2 : 0 }}
      />
      <div className="cl-meta" style={{ flex: 1, minWidth: 200 }}>
        <div className="cl-t">{r.title}</div>
        <div className="cl-d">
          {r.author} {r.dateFinished ? `- read ${r.dateFinished}` : ''}
        </div>

        {editable && (
          <div style={{ marginTop: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {r.candidates.length > 0 && (
              <select
                className="fld"
                value=""
                onChange={(e) => {
                  if (e.target.value) onResolve(e.target.value)
                }}
              >
                <option value="">
                  {r.status === 'ambiguous' ? 'Pick a suggested match...' : 'Suggested matches...'}
                </option>
                {r.candidates.map((c) => (
                  <option key={c.libraryItemId} value={c.libraryItemId}>
                    {c.title} - {c.author}
                  </option>
                ))}
              </select>
            )}

            <div style={{ position: 'relative' }}>
              <input
                className="fld"
                type="text"
                placeholder="Search your library..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && (
                <div
                  className="cfg-card"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    marginTop: 4,
                    padding: 4,
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {isFetching && <div className="cl-d" style={{ padding: '8px 10px' }}>Searching...</div>}
                  {!isFetching && results?.length === 0 && (
                    <div className="cl-d" style={{ padding: '8px 10px' }}>No matches found.</div>
                  )}
                  {!isFetching &&
                    results?.map((res) => (
                      <div
                        key={res.id}
                        className="cfg-line"
                        style={{ padding: '8px 10px', cursor: 'pointer' }}
                        onClick={() => {
                          setQuery('')
                          onResolve(res.id)
                        }}
                      >
                        <div className="cl-meta">
                          <div className="cl-t">{res.title}</div>
                          <div className="cl-d">{res.author}</div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editable ? (
        <button
          className="icon-btn"
          title="Skip - keep as history only, no library match"
          aria-label="Skip - keep as history only, no library match"
          onClick={() => onResolve(null)}
        >
          <Icon name="block" />
        </button>
      ) : (
        <button
          className="badge-pill"
          style={{ cursor: 'pointer', border: 'none' }}
          onClick={onEdit}
          title="Click to change"
        >
          {r.resolvedLibraryItemId ? 'Matched' : 'History only'}
        </button>
      )}
    </div>
  )
}
