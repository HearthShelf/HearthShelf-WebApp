import { useState } from 'react'
import { PinEntryOverlay } from '@/components/account/PinEntryOverlay'

// DEV-ONLY visual harness for the PIN entry overlay. Renders the pad outside the
// auth/server stack so the layout, touch targets, and wrong-PIN shake can be
// checked without Clerk or a live ABS server. The correct PIN here is "1234".
// Gated to import.meta.env.DEV in the router - never reachable in production.
export function PinEntryHarness() {
  const [open, setOpen] = useState(true)
  const [result, setResult] = useState<string>('')

  return (
    <div className="dark" style={{ minHeight: '100vh', background: 'var(--background)', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', color: 'var(--text)' }}>
        <p>PIN harness - correct PIN is <b>1234</b></p>
        <p style={{ color: 'var(--text-muted)' }}>{result}</p>
        <button className="pin-key" style={{ width: 120, aspectRatio: 'auto', padding: '10px 18px', borderRadius: 12 }} onClick={() => { setResult(''); setOpen(true) }}>
          Reopen
        </button>
      </div>
      {open && (
        <PinEntryOverlay
          name="Jaime"
          verify={(pin) => pin === '1234'}
          onSuccess={() => { setResult('Unlocked'); setOpen(false) }}
          onCancel={() => { setResult('Cancelled'); setOpen(false) }}
        />
      )}
    </div>
  )
}
