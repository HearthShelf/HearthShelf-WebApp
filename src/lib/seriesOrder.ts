import type { AbsLibraryItem } from '@/api/absLibrary'

/**
 * Order a series' books by their sequence number. ABS stores the sequence in the
 * denormalized seriesName string (e.g. "Foundation #2"), so we parse the trailing
 * "#<n>" off each book and sort ascending. Books without a sequence sort to the
 * front (sequence 0). Returns a new array; the input is left untouched.
 */
export function orderBooks(books: AbsLibraryItem[]): AbsLibraryItem[] {
  return [...books].sort((a, b) => seqOf(a) - seqOf(b))
}

function seqOf(item: AbsLibraryItem): number {
  const match = item.media.metadata.seriesName?.match(/#?([\d.]+)\s*$/)
  return Number(match?.[1] ?? 0)
}
