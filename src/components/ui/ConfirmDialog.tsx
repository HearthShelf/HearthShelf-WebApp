import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Lightweight confirm modal for destructive or irreversible actions. Mirrors the
 * LinkServerDialog chrome (backdrop, card, escape-to-close) so dialogs feel of a
 * piece. The confirm button is destructive by default; pass `confirmVariant` to
 * soften it for non-destructive confirmations.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'destructive'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />

      <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="confirm-title" className="t-h2">
          {title}
        </h2>
        <div className="t-muted mt-2 text-[14px]">{message}</div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
