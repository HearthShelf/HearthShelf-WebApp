import { useMutation, useQueryClient } from '@tanstack/react-query'
import { setItemFinished } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useFinishPrompt } from '@/components/shared/FinishPrompt'

/**
 * Mark one or more items finished / not finished on the active server, then
 * refresh the progress-derived caches so tiles, shelves, and detail pages update.
 */
export function useMarkFinished() {
  const qc = useQueryClient()
  const { target } = useActiveServer()

  const mutation = useMutation({
    mutationFn: async ({
      ids,
      isFinished,
      finishedAt,
    }: {
      ids: string[]
      isFinished: boolean
      finishedAt?: number
    }) => {
      if (!target) return
      await Promise.all(ids.map((id) => setItemFinished(target, id, isFinished, finishedAt)))
    },
    onSuccess: () => {
      const sid = target?.serverId
      qc.invalidateQueries({ queryKey: ['abs-media-progress', sid] })
      qc.invalidateQueries({ queryKey: ['abs-shelves', sid] })
    },
  })

  return {
    // finishedAt (epoch ms) backdates completion for stats; ignored when unfinishing.
    markFinished: (ids: string[], isFinished: boolean, finishedAt?: number) =>
      mutation.mutateAsync({ ids, isFinished, finishedAt }),
    isPending: mutation.isPending,
  }
}

/**
 * Same as {@link useMarkFinished}, but finishing first asks "when did you finish
 * this?" so completion can be backdated for accurate stats. Unfinishing is
 * instant (no prompt). Resolves false when the user dismisses the prompt so
 * callers can skip their success toast.
 */
export function usePromptedMarkFinished() {
  const { markFinished, isPending } = useMarkFinished()
  const { promptFinish } = useFinishPrompt()

  const markFinishedPrompted = async (ids: string[], isFinished: boolean): Promise<boolean> => {
    let finishedAt: number | undefined
    if (isFinished) {
      const choice = await promptFinish({ count: ids.length })
      if (!choice) return false
      finishedAt = choice.finishedAt ?? undefined
    }
    await markFinished(ids, isFinished, finishedAt)
    return true
  }

  return { markFinishedPrompted, isPending }
}
