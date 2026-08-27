import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAllLibraryItemsFull } from '@/api/absLibrary'
import { qgAssess } from '@/api/absQuestGiver'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { useQuestGiverEnabled } from '@/hooks/useQuestGiver'
import {
  qgAssessmentContext,
  type QgAssessment,
  type QgAssessmentTarget,
} from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

interface QuestGiverAssessmentProps {
  libraryId: string | null | undefined
  target: QgAssessmentTarget
}

const verdictLabels: Record<QgAssessment['verdict'], string> = {
  strong: 'Very likely',
  good: 'Likely',
  mixed: 'Maybe',
  unlikely: 'Probably not',
  unknown: 'Not enough history',
}

/**
 * "Would I like this?" - the contextual fit check on book and series pages.
 *
 * Judges the target against the listener's own library, deliberately excluding
 * the target itself (and, for a series, every book in it) so the verdict is not
 * circular. AI-powered whenever the server has a provider configured; qgAssess
 * degrades to the deterministic heuristic otherwise, and the footer says which
 * engine actually answered.
 */
export function QuestGiverAssessment({ libraryId, target }: QuestGiverAssessmentProps) {
  const enabled = useQuestGiverEnabled()
  const { target: server } = useActiveServer()
  const progressById = useMediaProgress()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [assessment, setAssessment] = useState<QgAssessment | null>(null)

  // Same key + fetcher as QuestGiverPage, so opening this reuses that cache
  // instead of refetching the whole library.
  const { data } = useQuery({
    queryKey: ['questgiver', 'all-items', server?.serverId, libraryId],
    queryFn: () => getAllLibraryItemsFull(server!, libraryId as string),
    enabled: enabled && Boolean(server) && Boolean(libraryId),
    staleTime: 10 * 60 * 1000,
  })

  if (!enabled) return null

  const assess = async () => {
    setOpen(true)
    if (assessment || loading || !data) return
    setLoading(true)
    try {
      const context = qgAssessmentContext(target, data.results ?? [], progressById)
      setAssessment(await qgAssess(server, context))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button className="pill qg-assess-trigger" onClick={() => void assess()} disabled={!data}>
        <Icon name="auto_awesome" fill /> Would I like this?
      </button>
      {open && (
        <Modal title="QuestGiver's take" onClose={() => setOpen(false)}>
          <div className="qg-assess">
            <div className="qg-assess-target">
              <span>{target.kind === 'series' ? 'Series' : 'Book'}</span>
              <strong>{target.title}</strong>
              {target.author && <small>{target.author}</small>}
            </div>
            {loading || !assessment ? (
              <div className="qg-assess-loading" aria-live="polite">
                <span className="qg-spinner">
                  <span />
                  <span />
                  <span />
                </span>
                Comparing this with your listening history...
              </div>
            ) : (
              <div aria-live="polite">
                <div className={`qg-assess-verdict ${assessment.verdict}`}>
                  <Icon name={assessment.verdict === 'unknown' ? 'help' : 'auto_awesome'} fill />
                  <div>
                    <strong>{verdictLabels[assessment.verdict]}</strong>
                    <span>{assessment.confidence} confidence</span>
                  </div>
                </div>
                <p className="qg-assess-summary">{assessment.summary}</p>
                <ul className="qg-assess-reasons">
                  {assessment.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {assessment.caution && <p className="qg-assess-caution">{assessment.caution}</p>}
                <div className="qg-assess-engine">
                  <Icon name={assessment.engine === 'ai' ? 'auto_awesome' : 'tune'} />
                  {assessment.engine === 'ai' ? 'Assessed by AI' : 'Matched from your history'}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
