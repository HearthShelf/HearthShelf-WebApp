import { useEffect, useRef, useState } from 'react'
import { X, Server, ArrowRight } from 'lucide-react'
import { useLinkServer } from '@/hooks/useServers'
import { Button } from '@/components/ui/Button'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/cn'

/**
 * Link-a-server flow. Walks the user through getting a pairing code from their
 * HearthShelf all-in-one (AIO) setup, then redeems it via the control plane.
 *
 * The code shape matches what the control plane mints: 8 chars from an
 * unambiguous alphabet, grouped XXXX-XXXX (see control-plane ids.ts). We keep
 * the input forgiving - uppercase, strip junk, auto-insert the dash - so a
 * pasted or hand-typed code lands the same way the server expects it.
 */

const SETUP_STEPS = [
  'In your HearthShelf server, open Settings and pick HearthShelf Connect (under Features).',
  'Press Connect. Your server shows a pairing code. (First-time setup also offers this.)',
  'Enter that code below. The code lasts 15 minutes and works once.',
]

/** Keep only code characters, uppercase, cap at 8, and group as XXXX-XXXX. */
function formatCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

export function LinkServerDialog({
  onClose,
  initialCode = '',
}: {
  onClose: () => void
  /** Prefilled code, e.g. from a /pair?code=... deep link out of HS onboarding. */
  initialCode?: string
}) {
  const [code, setCode] = useState(() => formatCode(initialCode))
  const link = useLinkServer()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const codeComplete = code.replace('-', '').length === 8

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!codeComplete) return
    link.mutate(
      { code },
      {
        onSuccess: (r) => {
          notify.success(`Linked ${r.server.name || 'your server'}`)
          onClose()
        },
        onError: (err) => notify.error(notify.fromError(err, 'Could not link that server')),
      }
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-server-title"
    >
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={18} />
        </button>

        <div className="mb-1 flex items-center gap-2">
          <Server size={18} className="text-muted-foreground" />
          <h2 id="link-server-title" className="t-h2">
            Link a server
          </h2>
        </div>
        <p className="t-muted mb-5 text-[13px]">
          Connect a HearthShelf server using the pairing code from its setup.
        </p>

        <ol className="mb-6 space-y-3">
          {SETUP_STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-medium text-secondary-foreground">
                {i + 1}
              </span>
              <span className="t-body pt-0.5 text-[14px] text-card-foreground">{step}</span>
            </li>
          ))}
        </ol>

        <form onSubmit={submit}>
          <label htmlFor="pairing-code" className="t-muted mb-2 block text-[13px]">
            Pairing code
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="pairing-code"
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={cn(
                'h-11 min-w-[12rem] flex-1 rounded-lg border border-input bg-background px-3',
                'text-center font-mono text-[17px] tracking-[0.2em] text-foreground placeholder:text-muted-foreground placeholder:tracking-normal',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            />
            <Button type="submit" disabled={!codeComplete || link.isPending}>
              {link.isPending ? (
                'Linking...'
              ) : (
                <>
                  Link
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
