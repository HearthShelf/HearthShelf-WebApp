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

/**
 * The book's own series number as written, for the reading-order column:
 * "Foundation #2.5" -> "2.5", an omnibus "Series #1-3.5" -> "1-3.5". A row's
 * position in the list is not its number - an omnibus or a half-step novella
 * shifts every row after it. '' when the book has no sequence.
 */
export function seriesSeqLabel(item: AbsLibraryItem): string {
  return seqLabel(item.media.metadata.seriesName?.match(/#\s*([\d.]+(?:\s*-\s*[\d.]+)?)\s*$/)?.[1])
}

export function seqLabel(sequence: string | null | undefined): string {
  return (sequence ?? '').replace(/\s+/g, '')
}

export type SeriesListRow<M> = { kind: 'owned'; book: AbsLibraryItem } | { kind: 'missing'; book: M }

/**
 * Fold the books the library doesn't have into the owned reading order, each at
 * its own place in the series, so a novella like #10.5 sits between 10 and 11
 * rather than after the last owned book. `owned` arrives in reading order.
 * An owned book wins a tie; a missing book with no sequence goes last.
 */
export function interleaveMissing<M extends { sequence?: string | null }>(
  owned: AbsLibraryItem[],
  missing: M[],
): SeriesListRow<M>[] {
  const missingKey = (m: M) => {
    const n = Number(m.sequence?.match(/([\d.]+)\s*$/)?.[1])
    return Number.isFinite(n) ? n : Infinity
  }
  const queue = [...missing].sort((a, b) => {
    const x = missingKey(a)
    const y = missingKey(b)
    return x === y ? 0 : x < y ? -1 : 1
  })
  const rows: SeriesListRow<M>[] = []
  let j = 0
  for (const book of owned) {
    while (j < queue.length && missingKey(queue[j]) < seqOf(book)) {
      rows.push({ kind: 'missing', book: queue[j++] })
    }
    rows.push({ kind: 'owned', book })
  }
  while (j < queue.length) rows.push({ kind: 'missing', book: queue[j++] })
  return rows
}
