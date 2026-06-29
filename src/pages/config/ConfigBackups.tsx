import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBackups,
  createBackup,
  deleteBackup,
  applyBackup,
  uploadBackup,
  backupDownloadUrl,
  adminSectionKeys,
  type ABSBackup,
} from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useToast } from '@/hooks/useToast'
import { Icon } from '@/components/common/Icon'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

function fmtBytes(b: number): string {
  const mb = b / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

export function ConfigBackups() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const { toast, show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const [running, setRunning] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<ABSBackup | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ABSBackup | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminSectionKeys.backups(target?.serverId ?? ''),
    queryFn: () => getBackups(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const backups = data?.backups ?? []

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: adminSectionKeys.backups(target.serverId) })

  const doRun = async () => {
    setRunning(true)
    try {
      await createBackup(target)
      invalidate()
      show('Backup created')
    } finally {
      setRunning(false)
    }
  }
  const doRestore = async (b: ABSBackup) => {
    await applyBackup(target, b.id)
    show('Restore started - the server is restarting')
  }
  const doDelete = async (b: ABSBackup) => {
    await deleteBackup(target, b.id)
    invalidate()
  }
  const doDownload = (b: ABSBackup) => {
    const url = backupDownloadUrl(target, b.id)
    if (url) window.open(url, '_blank', 'noopener')
  }
  const onUpload = async (file: File | undefined) => {
    if (!file) return
    try {
      await uploadBackup(target, file)
      invalidate()
      show('Backup uploaded')
    } catch {
      show('Could not upload backup')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Backups</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".audiobookshelf,application/zip"
            style={{ display: 'none' }}
            onChange={(e) => void onUpload(e.target.files?.[0])}
          />
          <button
            className="btn-sm btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" /> Upload
          </button>
          <button
            className="btn-sm btn-accent"
            disabled={running}
            onClick={() => setConfirmRun(true)}
          >
            <Icon name="cloud_sync" /> {running ? 'Backing up...' : 'Back up now'}
          </button>
        </div>
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading backups..." />}
      {isError && <ErrorState message="Could not load backups." onRetry={refetch} />}

      {data && (
        <>
          {data.backupLocation && (
            <p
              className="page-sub"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            >
              {data.backupLocation}
            </p>
          )}
          {backups.length === 0 ? (
            <div className="empty-state">
              <Icon name="cloud_sync" />
              <h3>No backups yet</h3>
              <p>Run a backup to capture your server's data, or upload one.</p>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Backup</th>
                    <th>Server</th>
                    <th>Size</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.datePretty}</td>
                      <td className="num">{b.serverVersion}</td>
                      <td className="num">{fmtBytes(b.fileSize)}</td>
                      <td>
                        <div className="t-actions">
                          <button
                            className="tbl-icon"
                            title="Download backup"
                            onClick={() => doDownload(b)}
                          >
                            <Icon name="download" />
                          </button>
                          <button
                            className="tbl-icon"
                            title="Restore from this backup"
                            onClick={() => setPendingRestore(b)}
                          >
                            <Icon name="restore" />
                          </button>
                          <button
                            className="tbl-icon"
                            title="Delete backup"
                            onClick={() => setPendingDelete(b)}
                          >
                            <Icon name="delete" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirmRun && (
        <ConfirmDialog
          title="Run a backup"
          message="Create a new backup of your AudiobookShelf data now? This may take a moment."
          confirmLabel="Back up now"
          onConfirm={() => void doRun()}
          onClose={() => setConfirmRun(false)}
        />
      )}

      {pendingRestore && (
        <ConfirmDialog
          title="Restore from backup"
          message={`Restore the server from "${pendingRestore.datePretty}"? This overwrites the current data and restarts the server. This cannot be undone.`}
          confirmLabel="Restore"
          danger
          onConfirm={() => void doRestore(pendingRestore)}
          onClose={() => setPendingRestore(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete backup"
          message={`Permanently delete the backup "${pendingDelete.datePretty}"? This cannot be undone.`}
          confirmLabel="Delete backup"
          danger
          onConfirm={() => void doDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
