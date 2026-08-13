import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/common/Icon'

// DEV-ONLY visual harness for the server-log viewer (inline + enlarged modal).
// The real page needs an authenticated admin server, so this drives the same
// markup from fixture lines - including the pathological ones: a very long
// unbroken path and the 300-char model list that used to push the modal
// off-screen. Gated to import.meta.env.DEV in the router.

const LEVEL_LABEL: Record<number, string> = {
  0: 'TRACE',
  1: 'DEBUG',
  2: 'INFO',
  3: 'WARN',
  4: 'ERROR',
  5: 'FATAL',
}

function clockOf(timestamp: string): string {
  const m = /\d{2}:\d{2}:\d{2}(?:\.\d+)?/.exec(timestamp)
  return m ? m[0] : timestamp
}

const LOGS = [
  { timestamp: '2026-08-13 02:42:24.298', level: 2, source: 'LogManager.js:71', message: '[LogManager] Init current daily log filename: 2026-08-13.txt' },
  { timestamp: '2026-08-13 02:42:24.425', level: 2, source: 'BackupManager.js:327', message: '[BackupManager] 7 Backups Found' },
  { timestamp: '2026-08-13 02:42:24.440', level: 2, source: 'Watcher.js:58', message: '[Watcher] Initializing watcher for "Audiobooks".' },
  { timestamp: '2026-08-13 02:42:24.452', level: 2, source: 'Server.js:425', message: '[Server] Listening on port :13378' },
  { timestamp: '2026-08-13 02:46:30.188', level: 2, source: 'PlaybackSessionManager.js:317', message: '[PlaybackSessionManager] startSession: Closing open session "Accidental Champion 2" for user "wutname1" (Device: Windows 10 / Edge)' },
  { timestamp: '2026-08-13 02:47:08.273', level: 2, source: 'LibraryItemController.js:1135', message: '[LibraryItemController] User "wutname1" requested download for item "Hollow" ebook at "/audiobooks/Travis Bagwell/Hollow B0D68GCK6V/Hollow.epub"' },
  { timestamp: '2026-08-13 02:47:25.078', level: 4, source: 'LibraryItemController.js:1130', message: '[LibraryItemController] No ebookFile for library item "Accidental Champion 2"' },
  { timestamp: '2026-08-13 02:49:00.818', level: 2, source: 'Database.js:217', message: '[Database] Initializing db at "/config/absdatabase.sqlite"' },
  { timestamp: '2026-08-13 02:49:00.852', level: 2, source: 'Database.js:292', message: '[Database] Loading extension /usr/local/lib/nusqlite3/libnusqlite3.so' },
  // The pathological one: a very long unbroken-ish run that previously blew out the width.
  { timestamp: '2026-08-13 02:49:00.978', level: 2, source: 'Database.js:201', message: '[Database] Db initialized with models: user, session, apiKey, library, libraryFolder, book, podcast, podcastEpisode, libraryItem, mediaProgress, series, bookSeries, author, bookAuthor, collection, collectionBook, playlist, playlistMediaItem, device, playbackSession, feed, feedEpisode, setting, customMetadataProvider, mediaItemShare' },
  { timestamp: '2026-08-13 02:49:01.085', level: 3, source: 'Database.js:207', message: '[Database] running ANALYZE' },
  { timestamp: '2026-08-13 02:54:36.091', level: 1, source: 'Server.js:145', message: '[Server] Node.js Version: v24.18.1' },
  { timestamp: '2026-08-13 02:54:36.091', level: 0, source: 'Server.js:147', message: '[Server] Arch: x64' },
  { timestamp: '2026-08-13 02:55:10.004', level: 5, source: 'Server.js:900', message: '[Server] Unrecoverable: /a/very/long/unbroken/path/without/spaces/that/must/break/mid-token/or/it/will/force/the/grid/wider/than/the/modal/and/push/it/off/screen/entirely.log' },
]

function LogView({ className }: { className?: string }) {
  return (
    <div className={'log-box' + (className ? ' ' + className : '')}>
      {LOGS.map((l, i) => {
        const level = l.level != null ? (LEVEL_LABEL[l.level] ?? String(l.level)) : ''
        return (
          <div className="log-line" key={i}>
            <span className="ts" title={l.timestamp}>
              {clockOf(l.timestamp)}
            </span>
            <span className={'lv ' + level.toLowerCase()}>{level}</span>
            <span className="src" title={l.source}>
              {l.source}
            </span>
            <span className="msg">{l.message}</span>
          </div>
        )
      })}
    </div>
  )
}

export function LogViewHarness() {
  const [enlarged, setEnlarged] = useState(false)
  // Reproduces the REAL wrapper the config pages render inside:
  // .page.config-wrap.fade-in, whose `animation: fadeIn ... both` leaves a
  // transform applied permanently, making it the containing block for
  // position:fixed. That plus config-wrap's 1180px max-width is what pushed
  // the enlarged modal off-screen - so the harness must keep both to prove the
  // portal actually fixes it.
  return (
    <div className="page config-wrap fade-in" style={{ display: 'block' }}>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Logs</h1>
        <p className="page-sub">Harness · {LOGS.length} lines</p>
      </div>
      <div className="log-toolbar">
        <button className="btn-sm btn-ghost" onClick={() => setEnlarged(true)}>
          <Icon name="open_in_full" /> Enlarge
        </button>
      </div>
      <LogView />

      {enlarged &&
        createPortal(
          <div className="modal-scrim open" onClick={() => setEnlarged(false)}>
            <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <Icon name="terminal" />
                <h2>Server log · {LOGS.length} lines</h2>
                <button className="modal-nav-btn" onClick={() => setEnlarged(false)}>
                  <Icon name="close" />
                </button>
              </div>
              <div className="modal-body">
                <LogView className="log-box-fill" />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
