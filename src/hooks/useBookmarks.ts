import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBookmarks, createBookmark, deleteBookmark, type AbsBookmark } from '@/api/absPlayback'
import { useActiveServer } from '@/hooks/useActiveServer'
import type { AbsTarget } from '@/api/absLibrary'

// Real ABS bookmarks for a single item on the active server. The full list comes
// from /api/me (bookmarks[]) filtered by libraryItemId; create/delete mutate ABS
// and refresh the cache.
export function useBookmarks(libraryItemId: string | null) {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const key = ['abs-bookmarks', target?.serverId]

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getBookmarks(target as AbsTarget),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const bookmarks: AbsBookmark[] = (data ?? [])
    .filter((b) => b.libraryItemId === libraryItemId)
    .sort((a, b) => a.time - b.time)

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: ({ time, title }: { time: number; title: string }) =>
      createBookmark(target as AbsTarget, libraryItemId as string, time, title),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (time: number) =>
      deleteBookmark(target as AbsTarget, libraryItemId as string, time),
    onSuccess: invalidate,
  })

  return {
    bookmarks,
    addBookmark: (time: number, title: string) => add.mutate({ time, title }),
    removeBookmark: (time: number) => remove.mutate(time),
  }
}
