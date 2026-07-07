import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

const CONFIRM_WORD = 'DELETE'

/**
 * Confirmation for the irreversible "delete my HearthShelf data" action.
 * Modeled on ui/ConfirmDialog's chrome (backdrop, card, escape-to-close, busy
 * state) but adds a required type-to-confirm input - this dialog is intentionally
 * NOT a drop-in replacement for ConfirmDialog, since every other caller of that
 * component is fine with a plain confirm/cancel and shouldn't gain this friction.
 */
export function DeleteAccountDialog({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const canConfirm = typed.trim() === CONFIRM_WORD && !busy

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
      aria-labelledby="delete-account-title"
    >
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />

      <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="delete-account-title" className="t-h2">
          Delete my HearthShelf data
        </h2>
        <div className="t-muted mt-2 space-y-2 text-[14px]">
          <p>
            This permanently deletes your HearthShelf account: linked-server pairings, plan info,
            remembered devices, crash reports, and your sign-in identity. This cannot be undone.
          </p>
          <p>
            This does <strong>not</strong> delete anything on your own self-hosted AudiobookShelf or
            HearthShelf server - that's your infrastructure. We only remove our record of the
            pairing.
          </p>
        </div>

        <label className="mt-4 block">
          <span className="t-muted text-[12px]">
            Type <strong className="text-card-foreground">{CONFIRM_WORD}</strong> to confirm
          </span>
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? 'Deleting...' : 'Delete everything'}
          </Button>
        </div>
      </div>
    </div>
  )
}
