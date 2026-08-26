import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { HSClub } from '@hearthshelf/core'
import { renameClub, setClubSettings } from '@/api/absClubs'
import type { AbsTarget } from '@/api/absLibrary'
import { Modal } from '@/components/common/Modal'
import { SetRow, Toggle } from '@/components/settings/controls'

/**
 * The owner-only club settings sheet, shared by the club room and the player
 * sidecar so the two can't drift apart on wording or on which policies are
 * reachable from where.
 *
 * Drafts seed from `club` once on mount rather than tracking it, so a refetch
 * while the owner is mid-edit can't yank a half-typed name out from under them.
 * Callers therefore mount this only while it is open.
 */
export function ClubSettingsModal({
  target,
  club,
  onClose,
  onSaved,
  onError,
}: {
  target: AbsTarget
  club: HSClub
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [nameDraft, setNameDraft] = useState(club.name)
  const [allowEditing, setAllowEditing] = useState(club.allowCommentEditing)
  const [allowReplies, setAllowReplies] = useState(club.allowReplies)
  const [autoAdvance, setAutoAdvance] = useState(club.autoAdvanceOnAllFinished)

  // Rename and the policy toggles are separate endpoints, so the rename fires
  // only when the name actually changed - saving an untouched name would
  // otherwise push a pointless write every time.
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = nameDraft.trim()
      if (trimmed && trimmed !== club.name) await renameClub(target, club.id, trimmed)
      await setClubSettings(target, club.id, {
        allowCommentEditing: allowEditing,
        allowReplies,
        autoAdvanceOnAllFinished: autoAdvance,
      })
    },
    onSuccess: () => {
      onClose()
      onSaved()
    },
    onError: () => onError('Could not save club settings.'),
  })

  return (
    <Modal
      title="Club settings"
      onClose={onClose}
      foot={
        <>
          <button className="pill" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={save.isPending || !nameDraft.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="book-club-settings">
        <SetRow
          title="Club name"
          desc="Everyone in the club sees the new name right away."
          stacked
          control={null}
        >
          <input
            type="text"
            value={nameDraft}
            maxLength={120}
            placeholder="Club name"
            aria-label="Club name"
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </SetRow>
        <SetRow
          title="Allow member comment editing"
          desc="Members can revise their own text and add or remove the spoiler flag."
          control={<Toggle on={allowEditing} onChange={setAllowEditing} />}
        />
        <SetRow
          title="Allow replies"
          desc="Members can reply to existing top-level comments. Existing replies stay readable."
          control={<Toggle on={allowReplies} onChange={setAllowReplies} />}
        />
        <SetRow
          title="Move on when everyone has finished"
          desc="Once every reader who started the book finishes it, the club marks it read and starts the next book in Up next."
          control={<Toggle on={autoAdvance} onChange={setAutoAdvance} />}
        />
      </div>
    </Modal>
  )
}
