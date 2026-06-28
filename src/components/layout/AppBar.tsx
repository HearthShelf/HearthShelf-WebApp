import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { useActiveLibrary, libraryIcon } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'

/**
 * Combined Server + Library switcher.
 *
 * Most users have one server, so it reads as a plain library switcher. With more
 * than one server it groups libraries under each server name - the ONLY place a
 * server name appears in the chrome, and never the Direct URL. Switching to a
 * different server's library sets the active server (the shell reconnects) and
 * the library in one click.
 */
function LibrarySwitcher() {
  const { server: activeServer, servers, setActiveServer } = useActiveServer()
  const { libraries, active, activeId, select } = useActiveLibrary()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const multiServer = servers.length > 1
  // Nothing to switch between: one server with <=1 library. Hide the control.
  if (!multiServer && libraries.length <= 1) return null
  if (!active && !multiServer) return <div className="lib-switch" />

  return (
    <div className="lib-switch" onClick={(e) => e.stopPropagation()}>
      <button className="lib-btn" onClick={() => setOpen((o) => !o)}>
        <span className="lib-ico">
          <Icon name={active ? libraryIcon(active) : 'dns'} fill />
        </span>
        <span className="lib-name">{active?.name ?? activeServer?.name ?? 'Library'}</span>
        <Icon name="unfold_more" />
      </button>
      {open && (
        <div className="lib-menu">
          {multiServer ? (
            servers.map((s) => (
              <div key={s.id}>
                <div className="lm-label">{s.name}</div>
                {s.id === activeServer?.id ? (
                  libraries.map((l) => (
                    <button
                      key={l.id}
                      className={'lm-item' + (l.id === activeId ? ' on' : '')}
                      onClick={() => {
                        select(l.id)
                        setOpen(false)
                      }}
                    >
                      <span className="lib-ico">
                        <Icon name={libraryIcon(l)} fill={l.id === activeId} />
                      </span>
                      <span className="lm-meta">
                        <span className="lm-name">{l.name}</span>
                        <span className="lm-sub">
                          {l.mediaType === 'podcast' ? 'Podcasts' : 'Audiobooks'}
                        </span>
                      </span>
                      {l.id === activeId && <Icon name="check" className="check" />}
                    </button>
                  ))
                ) : (
                  <button
                    className="lm-item"
                    onClick={() => {
                      setActiveServer(s.id)
                      setOpen(false)
                    }}
                  >
                    <span className="lib-ico">
                      <Icon name="dns" />
                    </span>
                    <span className="lm-meta">
                      <span className="lm-name">Switch to this server</span>
                    </span>
                  </button>
                )}
              </div>
            ))
          ) : (
            <>
              <div className="lm-label">Your libraries</div>
              {libraries.map((l) => (
                <button
                  key={l.id}
                  className={'lm-item' + (l.id === activeId ? ' on' : '')}
                  onClick={() => {
                    select(l.id)
                    setOpen(false)
                  }}
                >
                  <span className="lib-ico">
                    <Icon name={libraryIcon(l)} fill={l.id === activeId} />
                  </span>
                  <span className="lm-meta">
                    <span className="lm-name">{l.name}</span>
                    <span className="lm-sub">
                      {l.mediaType === 'podcast' ? 'Podcasts' : 'Audiobooks'}
                    </span>
                  </span>
                  {l.id === activeId && <Icon name="check" className="check" />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SearchBox() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Press "/" anywhere (outside a field) to focus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`)
  }

  return (
    <form className="search" onSubmit={submit}>
      <Icon name="search" className="s-ico" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your library"
        aria-label="Search"
      />
    </form>
  )
}

export function AppBar() {
  return (
    <header className="appbar">
      <LibrarySwitcher />
      <SearchBox />
      <div className="ab-spacer" />
    </header>
  )
}
