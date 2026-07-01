import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'

const PIN_LENGTH = 4

export interface PinEntryOverlayProps {
  // Who we're unlocking - shown so the driver knows which account they're
  // switching into on a shared screen.
  name: string
  imageUrl?: string
  // Return true if the entered PIN is correct. Async so the caller can hash /
  // compare however it wants; a wrong result shakes and clears the pad.
  verify: (pin: string) => boolean | Promise<boolean>
  onSuccess: () => void
  onCancel: () => void
}

// Full-screen, touch-first PIN pad for switching into a PIN-protected account.
// Built for at-arm's-length car use: a 3x4 number grid with large targets that
// scale with the viewport via container queries, matching the car player idiom.
// Renders through a portal above the routed page (like Modal) so nothing in the
// player tree unmounts while it's up.
export function PinEntryOverlay({
  name,
  imageUrl,
  verify,
  onSuccess,
  onCancel,
}: PinEntryOverlayProps) {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [checking, setChecking] = useState(false)
  const shakeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])

  const close = useCallback(
    (done: () => void) => {
      setOpen(false)
      window.setTimeout(done, 250)
    },
    []
  )

  const reject = useCallback(() => {
    setShake(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => {
      setShake(false)
      setPin('')
    }, 500)
  }, [])

  const submit = useCallback(
    async (value: string) => {
      setChecking(true)
      try {
        const ok = await verify(value)
        if (ok) {
          close(onSuccess)
        } else {
          reject()
        }
      } finally {
        setChecking(false)
      }
    },
    [verify, onSuccess, close, reject]
  )

  const press = useCallback(
    (digit: string) => {
      if (checking || shake) return
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev
        const next = prev + digit
        if (next.length === PIN_LENGTH) void submit(next)
        return next
      })
    },
    [checking, shake, submit]
  )

  const backspace = useCallback(() => {
    if (checking) return
    setPin((prev) => prev.slice(0, -1))
  }, [checking])

  // Hardware keyboard support - a paired keyboard or the desktop case.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Escape') close(onCancel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, backspace, close, onCancel])

  useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return createPortal(
    <div className={'pin-scrim' + (open ? ' open' : '')}>
      <div className="pin-card">
        <button
          className="pin-cancel car-icon-btn"
          onClick={() => close(onCancel)}
          aria-label="Cancel"
        >
          <Icon name="close" />
        </button>

        <div className="pin-who">
          <Avatar name={name} imageUrl={imageUrl} size={64} />
          <div className="pin-title">Enter {name}'s PIN</div>
        </div>

        <div className={'pin-dots' + (shake ? ' shake' : '')}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={'pin-dot' + (i < pin.length ? ' on' : '')} />
          ))}
        </div>

        <div className="pin-pad">
          {keys.map((k) => (
            <button key={k} className="pin-key" onClick={() => press(k)} disabled={checking}>
              {k}
            </button>
          ))}
          <span className="pin-key pin-key-empty" aria-hidden />
          <button className="pin-key" onClick={() => press('0')} disabled={checking}>
            0
          </button>
          <button
            className="pin-key pin-key-icon"
            onClick={backspace}
            disabled={checking || pin.length === 0}
            aria-label="Delete"
          >
            <Icon name="backspace" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
