import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { searchSettings, type SettingEntry } from '@/components/settings/searchIndex'

// Search across every setting, not just section names, so "sleep" or "speed"
// lands on the control instead of making people open sections one at a time.
// Picking a result navigates to its section and highlights the row there.
export function SettingsSearch({
  onPick,
  basePath = '/account',
}: {
  onPick?: () => void
  /** Overridden by the dev harness, which routes results to itself. */
  basePath?: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => searchSettings(query).slice(0, 8), [query])
  const open = query.trim().length > 0

  // Keep the highlighted result in range as the list shrinks under typing.
  useEffect(() => setActive(0), [query])

  // "/" focuses search from anywhere on the page, the way the rest of the app
  // treats it - but never while the user is typing into another field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll the keyboard-selected row into view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('.ss-result.on')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(entry: SettingEntry) {
    setQuery('')
    // The target row is highlighted on arrival; the section reads it from state
    // so a refresh doesn't leave a stale highlight behind.
    navigate(`${basePath}/${entry.section}`, { state: { highlight: entry.title } })
    onPick?.()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[active])
    }
  }

  return (
    <div className="ss-wrap">
      <div className="ss-field">
        <Icon name="search" className="ss-icon" />
        <input
          ref={inputRef}
          className="ss-input"
          type="search"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button className="ss-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" />
          </button>
        )}
      </div>

      {open && (
        <div className="ss-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="ss-empty">No settings match "{query.trim()}".</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.section}-${r.title}`}
                role="option"
                aria-selected={i === active}
                className={'ss-result' + (i === active ? ' on' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
              >
                <Icon name={r.icon} className="ss-r-icon" />
                <span className="ss-r-meta">
                  <span className="ss-r-t">{r.title}</span>
                  {r.desc && <span className="ss-r-d">{r.desc}</span>}
                </span>
                <span className="ss-r-sec">{r.sectionLabel}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
