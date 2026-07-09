import { useState, useMemo, useEffect, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAllLibraryItemsFull,
  getSeries,
  getAuthors,
  getMe,
  updateAuthor,
  renameNarrator,
  batchDeleteItems,
  batchScanItems,
  batchQuickMatchItems,
  libraryDownloadUrl,
  type AbsLibraryItem,
  type AbsSeries,
} from '@/api/absLibrary'
import { useToast } from '@/hooks/useToast'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { usePromptedMarkFinished } from '@/hooks/useMarkFinished'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Cover, tintFor } from '@/components/shared/Cover'
import { PodcastsGrid } from '@/pages/PodcastsGrid'
import { BookTile } from '@/components/library/BookTile'
import { SeriesCard } from '@/components/library/SeriesCard'
import { AzJumpRail } from '@/components/library/AzJumpRail'
import { letterOf } from '@hearthshelf/core'
import { BatchEditModal } from '@/components/library/BatchEditModal'
import { AddToListModal } from '@/components/library/AddToListModal'
import { PersonCard, type Person } from '@/components/library/PersonCard'
import { PersonEditModal, PersonDeleteModal } from '@/components/library/PersonModals'
import { MergeModal, type MergeItem } from '@/components/common/MergeModal'
import { Dropdown, MItem } from '@/components/common/Dropdown'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import {
  LibraryFilterMenu,
  LibrarySortMenu,
  type ProgFilter,
} from '@/components/library/LibraryFilters'
import { applyLibraryFilter, type LibrarySort } from '@hearthshelf/core'

type Tab = 'books' | 'series' | 'authors' | 'narrators'
type View = 'grid' | 'list'

const VIEW_KEY = 'hearthshelf:libraryView'
const SCALE_KEY = 'hearthshelf:libraryScale'
const FILL_KEY = 'hearthshelf:libraryFill'
const SCALE_MIN = 120
const SCALE_MAX = 240
const SCALE_DEFAULT = 168
// Below this tile size the grid switches to the denser "compact" caption layout.
const COMPACT_BELOW = 150

interface DerivedPerson {
  name: string
  count: number
  cv: string
  initials: string
}

function initialsOf(name: string): string {
  // First letters of the first and last meaningful name parts (handles dotted
  // initials like "J.N. Chaney" -> "JC").
  const letters = name.match(/[A-Za-z]/g) ?? []
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const first = parts[0].match(/[A-Za-z]/)?.[0] ?? ''
    const last = parts[parts.length - 1].match(/[A-Za-z]/)?.[0] ?? ''
    return (first + last).toUpperCase()
  }
  return letters.slice(0, 2).join('').toUpperCase()
}

export function LibraryPage() {
  const { target } = useActiveServer()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const narratorFilter = params.get('narrator')
  const genreParam = params.get('genre')
  const { active, activeId } = useActiveLibrary()
  const ui = useMediaUI()
  const progressById = useMediaProgress()
  const { markFinishedPrompted, isPending: marking } = usePromptedMarkFinished()
  const isMobile = useIsMobile()

  const [fill, setFillState] = useState<boolean>(() => localStorage.getItem(FILL_KEY) === '1')
  const setFill = (v: boolean) => {
    setFillState(v)
    localStorage.setItem(FILL_KEY, v ? '1' : '0')
  }

  const tabParam = params.get('tab')
  const [tab, setTab] = useState<Tab>(() =>
    tabParam === 'series' || tabParam === 'authors' || tabParam === 'narrators'
      ? tabParam
      : 'books',
  )
  const [mSearch, setMSearch] = useState('')
  const [prog, setProg] = useState<ProgFilter>('all')
  // Unified "group|value" filter (genre/author/narrator/series/decade/...),
  // seeded from URL params for deep links into a genre or narrator.
  const [filter, setFilter] = useState<string>(() => {
    if (genreParam) return `genres|${genreParam}`
    if (narratorFilter) return `narrators|${narratorFilter}`
    return 'all'
  })
  const [sort, setSort] = useState<LibrarySort>('Title')
  const [desc, setDesc] = useState(false)
  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'list' ? 'list' : 'grid'
  })
  const [gridScale, setGridScale] = useState<number>(() => {
    const s = Number(localStorage.getItem(SCALE_KEY))
    return s >= SCALE_MIN && s <= SCALE_MAX ? s : SCALE_DEFAULT
  })
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchEditing, setBatchEditing] = useState(false)
  const [batchAdding, setBatchAdding] = useState(false)
  const [sSort, setSSort] = useState<'Name' | 'Books'>('Name')
  const [pSort, setPSort] = useState<'Name' | 'Books'>('Books')
  const [personSel, setPersonSel] = useState<Set<string>>(new Set())
  const [personEditing, setPersonEditing] = useState<Person | null>(null)
  const [personDeleting, setPersonDeleting] = useState<Person[] | null>(null)
  const [personMerging, setPersonMerging] = useState(false)
  const [personBusy, setPersonBusy] = useState(false)

  const setViewPersist = (v: View) => {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }
  const setScalePersist = (s: number) => {
    setGridScale(s)
    localStorage.setItem(SCALE_KEY, String(s))
  }
  // Mobile is always compact (the cover-size slider is hidden there).
  const isCompact = isMobile || gridScale < COMPACT_BELOW

  const allItemsKey = ['library-all-items', target?.serverId, activeId] as const

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: allItemsKey,
    queryFn: () => getAllLibraryItemsFull(target!, activeId as string),
    enabled: Boolean(target) && activeId !== null,
    staleTime: 2 * 60 * 1000,
  })

  const { data: seriesData } = useQuery({
    queryKey: ['library-series', target?.serverId, activeId],
    queryFn: () => getSeries(target!, activeId as string, 0, 1000),
    enabled: Boolean(target) && activeId !== null && tab === 'series',
    staleTime: 2 * 60 * 1000,
  })

  // Author name -> ID, so book tiles can link the author byline to the author
  // page (library items only carry the author name, not the ID).
  const { data: authorsData } = useQuery({
    queryKey: ['library-authors', target?.serverId, activeId],
    queryFn: () => getAuthors(target!, activeId as string),
    enabled: Boolean(target) && activeId !== null,
    staleTime: 5 * 60 * 1000,
  })
  const authorIdByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of authorsData?.authors ?? []) map.set(a.name, a.id)
    return map
  }, [authorsData])

  // Admin gating for the batch destructive/admin actions.
  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const isAdmin = me?.type === 'admin' || me?.type === 'root'
  const canDelete = isAdmin || Boolean(me?.permissions?.delete)
  const canUpdate = isAdmin || Boolean(me?.permissions?.update)

  const { toast, show } = useToast()
  const qc = useQueryClient()

  const allItems = useMemo<AbsLibraryItem[]>(() => data?.results ?? [], [data])

  // Filter + sort the books client-side. The progress segment (prog) and the
  // unified filter menu stack; both narrow the list.
  const books = useMemo(() => {
    let list = allItems
    if (prog !== 'all') {
      list = list.filter((it) => {
        const p = progressById.get(it.id)
        if (prog === 'finished') return p?.isFinished
        if (prog === 'in-progress') return p && !p.isFinished && p.progress > 0
        if (prog === 'not-started') return !p || p.progress === 0
        return true
      })
    }
    list = applyLibraryFilter(list, filter, (id) => progressById.get(id))

    const lastName = (n: string) => n.trim().split(/\s+/).pop() ?? n
    const cmp: Record<LibrarySort, (a: AbsLibraryItem, b: AbsLibraryItem) => number> = {
      Title: (a, b) =>
        (a.media.metadata.titleIgnorePrefix || a.media.metadata.title || '').localeCompare(
          b.media.metadata.titleIgnorePrefix || b.media.metadata.title || '',
        ),
      Author: (a, b) => a.media.metadata.authorName.localeCompare(b.media.metadata.authorName),
      'Author (Last, First)': (a, b) =>
        lastName(a.media.metadata.authorName).localeCompare(lastName(b.media.metadata.authorName)),
      'Published Year': (a, b) =>
        Number(a.media.metadata.publishedYear ?? 0) - Number(b.media.metadata.publishedYear ?? 0),
      'Date Added': (a, b) => a.addedAt - b.addedAt,
      Duration: (a, b) => (a.media.duration ?? 0) - (b.media.duration ?? 0),
      Size: (a, b) => (a.media.size ?? 0) - (b.media.size ?? 0),
      Progress: (a, b) =>
        (progressById.get(a.id)?.progress ?? 0) - (progressById.get(b.id)?.progress ?? 0),
      Random: () => 0,
    }
    const sorted = [...list].sort(cmp[sort])
    if (sort === 'Random') {
      // Deterministic-per-render shuffle so repeated renders are stable but the
      // order is mixed.
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor((((i * 9301 + 49297) % 233280) / 233280) * (i + 1))
        const tmp = sorted[i]
        sorted[i] = sorted[j]
        sorted[j] = tmp
      }
    }
    if (desc) sorted.reverse()
    return sorted
  }, [allItems, prog, filter, sort, desc, progressById])

  // Derive authors / narrators from the full item set.
  const derivePeople = (field: 'authorName' | 'narratorName'): DerivedPerson[] => {
    const map = new Map<string, { count: number; cv: string }>()
    for (const it of allItems) {
      const raw = it.media.metadata[field]
      if (!raw) continue
      for (const name of raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const cur = map.get(name)
        if (cur) cur.count++
        else map.set(name, { count: 1, cv: tintFor(it.media.metadata.title ?? name) })
      }
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      count: v.count,
      cv: v.cv,
      initials: initialsOf(name),
    }))
  }
  const authors = useMemo(() => derivePeople('authorName'), [allItems])
  const narrators = useMemo(() => derivePeople('narratorName'), [allItems])

  const sortedAuthors = useMemo(() => {
    const a = [...authors]
    a.sort(pSort === 'Name' ? (x, y) => x.name.localeCompare(y.name) : (x, y) => y.count - x.count)
    return a
  }, [authors, pSort])
  const sortedNarrators = useMemo(() => {
    const a = [...narrators]
    a.sort(pSort === 'Name' ? (x, y) => x.name.localeCompare(y.name) : (x, y) => y.count - x.count)
    return a
  }, [narrators, pSort])

  // Build Person[] for PersonCard (needs books list for cover strip).
  const authorPeople = useMemo((): Person[] => {
    const booksByAuthor = new Map<string, AbsLibraryItem[]>()
    for (const it of allItems) {
      const raw = it.media.metadata.authorName
      if (!raw) continue
      for (const name of raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const arr = booksByAuthor.get(name) ?? []
        arr.push(it)
        booksByAuthor.set(name, arr)
      }
    }
    return sortedAuthors.map((p) => {
      const absAuthor = authorsData?.authors.find((a) => a.name === p.name)
      const books = (booksByAuthor.get(p.name) ?? []).map((it) => ({
        id: it.id,
        title: it.media.metadata.title ?? '',
        author: it.media.metadata.authorName ?? '',
        mediaType: 'book' as const,
        durationSec: it.media.duration ?? 0,
        narrator: it.media.metadata.narratorName ?? '',
      }))
      return {
        id: absAuthor?.id ?? p.name,
        name: p.name,
        kind: 'author' as const,
        count: p.count,
        imagePath: absAuthor?.imagePath ?? null,
        books,
      }
    })
  }, [sortedAuthors, allItems, authorsData])

  const narratorPeople = useMemo((): Person[] => {
    const booksByNarrator = new Map<string, AbsLibraryItem[]>()
    for (const it of allItems) {
      const raw = it.media.metadata.narratorName
      if (!raw) continue
      for (const name of raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const arr = booksByNarrator.get(name) ?? []
        arr.push(it)
        booksByNarrator.set(name, arr)
      }
    }
    return sortedNarrators.map((p) => ({
      id: p.name,
      name: p.name,
      kind: 'narrator' as const,
      count: p.count,
      books: (booksByNarrator.get(p.name) ?? []).map((it) => ({
        id: it.id,
        title: it.media.metadata.title ?? '',
        author: it.media.metadata.authorName ?? '',
        mediaType: 'book' as const,
        durationSec: it.media.duration ?? 0,
        narrator: it.media.metadata.narratorName ?? '',
      })),
    }))
  }, [sortedNarrators, allItems])

  const personAnySelected = personSel.size > 0
  const togglePersonSel = (id: string) =>
    setPersonSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const personList = tab === 'authors' ? authorPeople : narratorPeople
  const selectedPeople = personList.filter((p) => personSel.has(p.id))
  const selectedPersonItems: MergeItem[] = selectedPeople.map((p) => ({
    id: p.id,
    name: p.name,
    numBooks: p.count,
  }))

  const invalidatePersons = () => {
    qc.invalidateQueries({ queryKey: ['library-authors', target?.serverId, activeId] })
    qc.invalidateQueries({ queryKey: allItemsKey })
  }

  const doPersonSave = async (patch: {
    name: string
    description?: string
    asin?: string
    imageUrl?: string
  }) => {
    if (!personEditing || !target || !activeId) return
    setPersonBusy(true)
    try {
      if (personEditing.kind === 'author' && personEditing.id !== personEditing.name) {
        await updateAuthor(target, personEditing.id, patch)
      } else {
        await renameNarrator(target, activeId, personEditing.name, patch.name)
      }
      await invalidatePersons()
      setPersonEditing(null)
    } catch {
      // leave modal open so user can retry
    } finally {
      setPersonBusy(false)
    }
  }

  const doPersonMerge = async (canonicalName: string) => {
    if (!target || !activeId) return
    for (const item of selectedPersonItems) {
      if (item.name === canonicalName) continue
      if (tab === 'authors') {
        const person = selectedPeople.find((p) => p.id === item.id)
        if (person && person.id !== person.name) {
          await updateAuthor(target, person.id, { name: canonicalName })
        }
      } else {
        await renameNarrator(target, activeId, item.name, canonicalName)
      }
    }
    await invalidatePersons()
    setPersonSel(new Set())
  }

  const doPersonDelete = async () => {
    if (!personDeleting || !target || !activeId) return
    setPersonBusy(true)
    try {
      for (const p of personDeleting) {
        if (p.kind === 'narrator') {
          await renameNarrator(target, activeId, p.name, 'Unknown')
        }
      }
      await invalidatePersons()
      setPersonSel(new Set())
      setPersonDeleting(null)
    } catch {
      // leave modal open
    } finally {
      setPersonBusy(false)
    }
  }

  const seriesList = useMemo(() => {
    const list: AbsSeries[] = [...(seriesData?.results ?? [])]
    list.sort(
      sSort === 'Name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => (b.books?.length ?? 0) - (a.books?.length ?? 0),
    )
    return list
  }, [seriesData, sSort])

  // Multi-select
  const anySelected = selected.size > 0
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const clearSel = () => setSelected(new Set())
  const selectAll = () => setSelected(new Set(books.map((b) => b.id)))

  const reloadItems = () => {
    qc.invalidateQueries({ queryKey: allItemsKey })
  }
  const batchAction = async (fn: (ids: string[]) => Promise<void>, done: string) => {
    const ids = [...selected]
    if (!ids.length) return
    await fn(ids)
    show(done)
    reloadItems()
    clearSel()
  }
  const batchDelete = () => {
    const ids = [...selected]
    if (!ids.length) return
    if (
      !window.confirm(
        `Delete ${ids.length} book${ids.length === 1 ? '' : 's'}? Files are removed from disk.`,
      )
    )
      return
    void batchAction(
      (idList) => batchDeleteItems(target!, idList),
      `Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}`,
    )
  }
  const batchDownloadHref =
    target && activeId && selected.size
      ? (libraryDownloadUrl(target, activeId, [...selected]) ?? undefined)
      : undefined

  const switchTab = (id: Tab) => {
    // Tapping the tab you're already on scrolls back to the top of the list.
    if (id === tab) {
      document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    clearSel()
    setTab(id)
  }

  // A narrator card click lands the user in the Books grid with filters cleared.
  const goBooks = () => {
    setFilter('all')
    setProg('all')
    setSort('Title')
    setDesc(false)
    setTab('books')
  }

  // Keep tab/filter in sync if the user navigates here with new query params
  // (e.g. the Narrators page links to /library?narrator=NAME).
  useEffect(() => {
    if (genreParam) setFilter(`genres|${genreParam}`)
    else if (narratorFilter) setFilter(`narrators|${narratorFilter}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreParam, narratorFilter])

  if (!target) return null

  // Podcast-type libraries render their own show grid (not the book tabs).
  if (active?.mediaType === 'podcast' && activeId) {
    return <PodcastsGrid libraryId={activeId} />
  }

  const TABS: { id: Tab; icon: string; label: string; n: number }[] = [
    { id: 'books', icon: 'grid_view', label: 'Books', n: data?.total ?? allItems.length },
    { id: 'series', icon: 'auto_stories', label: 'Series', n: seriesData?.total ?? 0 },
    { id: 'authors', icon: 'person', label: 'Authors', n: authors.length },
    { id: 'narrators', icon: 'mic', label: 'Narrators', n: narrators.length },
  ]

  return (
    <div
      className="page fade-in"
      style={
        fill && !isMobile
          ? {
              paddingTop: 24,
              maxWidth: 'none',
              paddingLeft: 'var(--s6)',
              paddingRight: 'var(--s6)',
            }
          : isMobile
            ? {}
            : { paddingTop: 24 }
      }
    >
      <div className="page-head lib-head">
        <div className="lib-head-titles">
          <div className="eyebrow">Your collection</div>
          <h1 className="title-xl">
            {active?.name ?? 'Library'}
            <span className="lib-count">
              {tab === 'books' && `${books.length} of ${data?.total ?? allItems.length} books`}
              {tab === 'series' && `${seriesList.length} series`}
              {tab === 'authors' && `${authors.length} authors`}
              {tab === 'narrators' && `${narrators.length} narrators`}
            </span>
          </h1>
        </div>
        {tab === 'books' && !anySelected && (
          <div className="lib-controls">
            <LibraryFilterMenu
              items={allItems}
              filter={filter}
              setFilter={setFilter}
              prog={prog}
              setProg={setProg}
            />
            <LibrarySortMenu
              sort={sort}
              desc={desc}
              setSort={setSort}
              toggleDesc={() => setDesc((d) => !d)}
            />
            {(filter !== 'all' || prog !== 'all') && (
              <button
                className="pill pill-sm"
                onClick={() => {
                  setFilter('all')
                  setProg('all')
                }}
                title="Clear all filters"
              >
                <Icon name="filter_alt_off" />
              </button>
            )}
          </div>
        )}
      </div>

      {isMobile && (
        <form
          className="ab-search lib-search"
          onSubmit={(e) => {
            e.preventDefault()
            const v = mSearch.trim()
            if (v) navigate(`/search?q=${encodeURIComponent(v)}`)
          }}
        >
          <Icon name="search" />
          <input
            value={mSearch}
            onChange={(e) => setMSearch(e.target.value)}
            placeholder={`Search ${active?.name ?? 'library'}...`}
            aria-label="Search library"
          />
        </form>
      )}

      <div className="qv-tabs">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={'qv-tab' + (tab === tb.id ? ' on' : '')}
            onClick={() => switchTab(tb.id)}
          >
            <Icon name={tb.icon} fill={tab === tb.id} />
            <span>{tb.label}</span>
            <span className="qv-count">{tb.n}</span>
          </button>
        ))}
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading library..." />}
      {isError && <ErrorState message="Could not load this library." onRetry={refetch} />}

      {/* ---- Books ---- */}
      {tab === 'books' && data && (
        <>
          {anySelected ? (
            <div className="toolbar2 sel-bar">
              <button className="pill" onClick={clearSel} title="Clear selection">
                <Icon name="close" />
              </button>
              <span className="count-badge" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                {selected.size} selected
              </span>
              {selected.size < books.length && (
                <button className="pill" onClick={selectAll}>
                  Select all {books.length}
                </button>
              )}
              <div className="tb-spacer" />
              <button
                className="pill"
                disabled={marking}
                onClick={() => {
                  const ids = [...selected]
                  const allFinished = ids.every((id) => progressById.get(id)?.isFinished)
                  void markFinishedPrompted(ids, !allFinished).then((ok) => {
                    if (ok) clearSel()
                  })
                }}
              >
                <Icon name="task_alt" />{' '}
                {[...selected].every((id) => progressById.get(id)?.isFinished)
                  ? 'Mark not finished'
                  : 'Mark finished'}
              </button>
              <button className="pill" onClick={() => setBatchEditing(true)}>
                <Icon name="edit" /> Edit
              </button>
              <button className="pill" onClick={() => setBatchAdding(true)}>
                <Icon name="playlist_add" /> Add to…
              </button>
              <Dropdown icon="more_horiz" label="More">
                {batchDownloadHref && (
                  <a className="mp-item" href={batchDownloadHref} target="_blank" rel="noreferrer">
                    <Icon name="download" /> Download
                  </a>
                )}
                {canUpdate && (
                  <>
                    <MItem
                      icon="auto_fix_high"
                      label="Quick match"
                      onClick={() =>
                        void batchAction(
                          (ids) => batchQuickMatchItems(target!, ids),
                          `Matching ${selected.size} book${selected.size === 1 ? '' : 's'}…`,
                        )
                      }
                    />
                    <MItem
                      icon="sync"
                      label="Re-scan"
                      onClick={() =>
                        void batchAction(
                          (ids) => batchScanItems(target!, ids),
                          `Re-scanning ${selected.size} book${selected.size === 1 ? '' : 's'}…`,
                        )
                      }
                    />
                  </>
                )}
                {canDelete && (
                  <>
                    <div className="mp-sep" />
                    <MItem icon="delete" label="Delete" danger onClick={batchDelete} />
                  </>
                )}
              </Dropdown>
            </div>
          ) : isMobile ? null : (
            <div className="toolbar2">
              <div className="tb-spacer" />
              <button
                className={'pill' + (fill ? ' on' : '')}
                onClick={() => setFill(!fill)}
                title={fill ? 'Full width' : 'Boxed'}
              >
                <Icon name={fill ? 'width_full' : 'width_normal'} /> {fill ? 'Full width' : 'Boxed'}
              </button>
              {view === 'grid' && (
                <div className="scale-ctl" title="Cover size">
                  <Icon name="photo_size_select_small" />
                  <div className="scale-track-wrap">
                    <input
                      type="range"
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step={4}
                      value={gridScale}
                      onChange={(e) => setScalePersist(Number(e.target.value))}
                      aria-label="Cover size"
                    />
                    <span
                      className="scale-tick"
                      style={{
                        left: ((SCALE_DEFAULT - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100 + '%',
                      }}
                    />
                    <span
                      className="scale-bubble"
                      style={{
                        left: ((gridScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100 + '%',
                      }}
                    >
                      {gridScale === SCALE_DEFAULT ? 'Default' : `${gridScale}px`}
                    </span>
                  </div>
                  <Icon name="photo_size_select_large" />
                </div>
              )}
              <div className="seg-view">
                {(
                  [
                    ['grid', 'grid_view'],
                    ['list', 'view_list'],
                  ] as [View, string][]
                ).map(([v, ic]) => (
                  <button
                    key={v}
                    className={view === v ? 'on' : ''}
                    onClick={() => setViewPersist(v)}
                    title={v}
                  >
                    <Icon name={ic} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {books.length === 0 && (
            <div className="empty-state">
              <Icon name="filter_alt_off" />
              <h3>No results for filter</h3>
              <p>Nothing in this library matches the active filter.</p>
              <button
                className="btn-sm btn-ghost"
                style={{ margin: '0 auto' }}
                onClick={() => {
                  setProg('all')
                  setFilter('all')
                }}
              >
                Clear filter
              </button>
            </div>
          )}

          {books.length > 0 &&
            (view === 'list' ? (
              <div className={'lib-list' + (anySelected ? ' selecting' : '')}>
                {books.map((b) => {
                  const p = progressById.get(b.id)
                  const m = b.media.metadata
                  const hours = b.media.duration ? Math.round(b.media.duration / 360) / 10 : 0
                  return (
                    <div
                      className={'ll-row' + (selected.has(b.id) ? ' sel' : '')}
                      key={b.id}
                      data-cv={tintFor(m.title ?? 'Untitled')}
                      onClick={() => (anySelected ? toggleSel(b.id) : ui.openItem(b.id))}
                    >
                      <Cover
                        itemId={b.id}
                        title={m.title ?? 'Untitled'}
                        fs={5}
                        overlay={
                          <button
                            className={'b-check' + (selected.has(b.id) ? ' on' : '')}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSel(b.id)
                            }}
                          >
                            <Icon
                              name="check"
                              fill
                              style={{ opacity: selected.has(b.id) ? 1 : 0 }}
                            />
                          </button>
                        }
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="ll-title">{m.title}</div>
                        <div className="ll-sub">
                          {m.authorName}
                          {m.narratorName && ` · ${m.narratorName}`}
                        </div>
                      </div>
                      <span className="ll-col">
                        {m.genres[0] ?? ''} {m.publishedYear ? `· ${m.publishedYear}` : ''}
                      </span>
                      {p && p.progress > 0 && !p.isFinished ? (
                        <div className="ll-prog">
                          <div className="prog-line">
                            <i style={{ width: p.progress * 100 + '%' }} />
                          </div>
                          <span>{Math.round(p.progress * 100)}%</span>
                        </div>
                      ) : (
                        <span className="ll-col mono" style={{ fontFamily: 'var(--font-mono)' }}>
                          {p?.isFinished ? 'Finished' : `${hours}h`}
                        </span>
                      )}
                      <button
                        className="ll-play"
                        onClick={(e) => {
                          e.stopPropagation()
                          ui.playItem(b.id)
                        }}
                      >
                        <Icon name="play_arrow" fill />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div
                className={
                  'lib-grid' + (isCompact ? ' compact' : '') + (anySelected ? ' selecting' : '')
                }
                style={{ '--tile': `${gridScale}px` } as CSSProperties}
              >
                {books.map((b) => {
                  const p = progressById.get(b.id)
                  return (
                    <BookTile
                      key={b.id}
                      item={b}
                      fs={Math.round(gridScale / 11.2)}
                      progress={p?.progress ?? 0}
                      finished={p?.isFinished}
                      compact={isCompact}
                      selected={selected.has(b.id)}
                      anySelected={anySelected}
                      onToggleSelect={() => toggleSel(b.id)}
                      authorId={authorIdByName.get(b.media.metadata.authorName)}
                      onToast={show}
                    />
                  )
                })}
              </div>
            ))}
        </>
      )}

      {/* ---- Series ---- */}
      {tab === 'series' && (
        <>
          <div className="toolbar2">
            <div className="tb-spacer" />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sort</span>
            <div className="seg">
              {(['Name', 'Books'] as const).map((o) => (
                <button key={o} className={sSort === o ? 'on' : ''} onClick={() => setSSort(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="series-grid">
            {seriesList.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        </>
      )}

      {/* ---- Authors / Narrators ---- */}
      {(tab === 'authors' || tab === 'narrators') && (
        <>
          <div className={'toolbar2' + (personAnySelected ? ' sel-bar' : '')}>
            {!personAnySelected && !isMobile && (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Hover to select, edit, or merge
              </span>
            )}
            {personSel.size === 1 && (
              <button
                className="btn-sm btn-ghost"
                onClick={() => setPersonEditing(selectedPeople[0])}
              >
                <Icon name="edit" /> Edit
              </button>
            )}
            {personSel.size >= 2 && (
              <button className="btn-sm btn-primary" onClick={() => setPersonMerging(true)}>
                <Icon name="merge" /> Merge {personSel.size}
              </button>
            )}
            {personAnySelected && (
              <button
                className="btn-sm btn-ghost danger"
                onClick={() => setPersonDeleting(selectedPeople)}
              >
                <Icon name="delete" /> Remove {personSel.size}
              </button>
            )}
            {personAnySelected && (
              <button className="btn-sm btn-ghost" onClick={() => setPersonSel(new Set())}>
                Clear
              </button>
            )}
            <div className="tb-spacer" />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sort</span>
            <div className="seg">
              {(['Name', 'Books'] as const).map((o) => (
                <button key={o} className={pSort === o ? 'on' : ''} onClick={() => setPSort(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const list = personList
            const seen = new Set<string>()
            const showRail = isMobile && pSort === 'Name'
            return (
              <div className={'az-wrap' + (showRail ? ' has-rail' : '')}>
                <div className="person-grid">
                  {list.map((p) => {
                    const letter = letterOf(p.name)
                    let dataLetter: string | undefined
                    if (pSort === 'Name' && !seen.has(letter)) {
                      seen.add(letter)
                      dataLetter = letter
                    }
                    return (
                      <div key={p.id} data-letter={dataLetter}>
                        <PersonCard
                          person={p}
                          selected={personSel.has(p.id)}
                          anySelected={personAnySelected}
                          onToggleSelect={() => togglePersonSel(p.id)}
                          onOpen={() => {
                            if (tab === 'narrators') {
                              const href = ui.narratorHref?.(p.name)
                              if (href) navigate(href)
                              else goBooks()
                              return
                            }
                            const href = ui.authorHref?.(p.id) ?? `/author/${p.id}`
                            navigate(href)
                          }}
                          onEdit={() => setPersonEditing(p)}
                        />
                      </div>
                    )
                  })}
                </div>
                {showRail && <AzJumpRail names={list.map((p) => p.name)} />}
              </div>
            )
          })()}
        </>
      )}

      {personMerging && (
        <MergeModal
          kind={tab === 'authors' ? 'author' : 'narrator'}
          items={selectedPersonItems}
          onMerge={doPersonMerge}
          onClose={() => setPersonMerging(false)}
        />
      )}
      {personEditing && (
        <PersonEditModal
          person={personEditing}
          saving={personBusy}
          onSave={doPersonSave}
          onChanged={invalidatePersons}
          onDelete={invalidatePersons}
          onClose={() => setPersonEditing(null)}
        />
      )}
      {personDeleting && (
        <PersonDeleteModal
          people={personDeleting}
          deleting={personBusy}
          onConfirm={doPersonDelete}
          onClose={() => setPersonDeleting(null)}
        />
      )}

      {batchEditing && (
        <BatchEditModal
          ids={[...selected]}
          items={books.filter((b) => selected.has(b.id))}
          target={target}
          onClose={() => setBatchEditing(false)}
          onDone={() => {
            reloadItems()
            setBatchEditing(false)
            clearSel()
          }}
        />
      )}
      {batchAdding && activeId && (
        <AddToListModal
          libraryItemIds={[...selected]}
          target={target}
          libraryId={activeId}
          onClose={() => setBatchAdding(false)}
          onToast={(msg) => {
            show(msg)
            setBatchAdding(false)
            clearSel()
          }}
        />
      )}
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
