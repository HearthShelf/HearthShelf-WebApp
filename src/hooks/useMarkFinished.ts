import { useMutation, useQueryClient } from '@tanstack/react-query'
import { setItemFinished } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'

/**
 * Mark one or more items finished / not finished on the active server, then
 * refresh the progress-derived caches so tiles, shelves, and detail pages update.
 */
export function useMarkFinished() {
  const qc = useQueryClient()
  const { target } = useActiveServer()

  const mutation = useMutation({
    mutationFn: async ({ ids, isFinished }: { ids: string[]; isFinished: boolean }) => {
      if (!target) return
      await Promise.all(ids.map((id) => setItemFinished(target, id, isFinished)))
    },
    onSuccess: () => {
      const sid = target?.serverId
      qc.invalidateQueries({ queryKey: ['abs-media-progress', sid] })
      qc.invalidateQueries({ queryKey: ['abs-shelves', sid] })
    },
  })

  return {
    markFinished: (ids: string[], isFinished: boolean) => mutation.mutateAsync({ ids, isFinished }),
    isPending: mutation.isPending,
  }
}
