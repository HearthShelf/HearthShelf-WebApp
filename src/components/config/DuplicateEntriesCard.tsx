import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { buildDuplicateIndex } from '@hearthshelf/core'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import {
  cleanUpDuplicates,
  getLibraryDuplicateGroups,
  type CleanupResult,
} from '@/api/absDuplicates'
import { learnDuplicates } from '@/lib/duplicates'
import { Icon } from '@/components/common/Icon'

/**
 * Admin notice on the Libraries page: books the server recorded twice (one
 * folder, two entries). Listeners already see one copy; "Clean up" moves the
 * admin's own place, checks every listener, then removes only the extra entries
 * nobody would lose a place on. Files on disk are never touched.
 */
export function DuplicateEntriesCard({
  target,
  libraryIds,
}: {
  target: AbsTarget
  libraryIds: string[]
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target.serverId],
    queryFn: () => getMe(target),
    staleTime: 10 * 60 * 1000,
  })
  // ABS admins and root may delete regardless of the per-user flag; checking
  // other listeners' progress needs admin too, so plain deleters are left out.
  const canClean = me?.type === 'admin' || me?.type === 'root'

  const groupsKey = ['abs-duplicate-groups', target.serverId, ...libraryIds]
  const { data: groups = [] } = useQuery({
    queryKey: groupsKey,
    queryFn: async () => {
      const all: Awaited<ReturnType<typeof getLibraryDuplicateGroups>> = []
      for (const id of libraryIds) all.push(...(await getLibraryDuplicateGroups(target, id)))
      learnDuplicates(target.serverId, buildDuplicateIndex(all))
      return all
    },
    enabled: canClean && libraryIds.length > 0,
    staleTime: 60 * 1000,
  })

  if (!canClean || (groups.length === 0 && !result)) return null

  const extra = groups.reduce((n, g) => n + g.duplicates.length, 0)

  const cleanUp = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await cleanUpDuplicates(target, groups)
      setResult(res)
      void qc.invalidateQueries({ queryKey: ['abs-duplicate-groups', target.serverId] })
      void qc.invalidateQueries({ queryKey: ['abs-duplicates', target.serverId] })
      void qc.invalidateQueries({ queryKey: ['library-all-items', target.serverId] })
      void qc.invalidateQueries({ queryKey: ['abs-media-progress', target.serverId] })
      void qc.invalidateQueries({ queryKey: ['abs-items-in-progress', target.serverId] })
    } catch {
      setError('Could not finish cleaning up. Nothing was lost - try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cfg-card" style={{ marginTop: 'var(--s5)' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="content_copy" style={{ color: 'var(--accent)' }} />
        Duplicate entries found
      </h3>
      {groups.length > 0 && (
        <>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '6px 0 12px' }}>
            Your server listed {groups.length === 1 ? 'one book' : `${groups.length} books`} twice (
            {extra} extra {extra === 1 ? 'entry' : 'entries'}). Listeners already see each book
            once. Cleaning up moves everyone&apos;s place to the copy that stays, then removes the
            extra entries. Your audio files are not touched.
          </p>
          <ul style={{ fontSize: 14, margin: '0 0 12px', paddingLeft: 18 }}>
            {groups.slice(0, 8).map((g) => (
              <li key={g.keeper.id}>{g.keeper.title || g.keeper.path || 'Untitled'}</li>
            ))}
            {groups.length > 8 && <li>and {groups.length - 8} more</li>}
          </ul>
          <button className="btn-sm btn-accent" disabled={busy} onClick={() => void cleanUp()}>
            <Icon name={busy ? 'hourglass_empty' : 'auto_fix_high'} />
            {busy ? 'Cleaning up...' : 'Clean up'}
          </button>
        </>
      )}
      {result && (
        <div style={{ fontSize: 14, marginTop: 12 }}>
          {result.removed > 0 && (
            <p>
              Removed {result.removed} extra {result.removed === 1 ? 'entry' : 'entries'}. Your
              books and files are untouched.
            </p>
          )}
          {result.kept.length > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              Kept {result.kept.length} for now: another listener&apos;s place is only saved on that
              copy. It moves over the next time they open HearthShelf. Run this again after.
            </p>
          )}
          {result.failed > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {result.failed} could not be removed. Try again in a moment.
            </p>
          )}
          {result.removed === 0 && result.kept.length === 0 && result.failed === 0 && (
            <p>Nothing left to clean up.</p>
          )}
        </div>
      )}
      {error && <p style={{ fontSize: 14, color: 'var(--destructive)', marginTop: 12 }}>{error}</p>}
    </div>
  )
}
