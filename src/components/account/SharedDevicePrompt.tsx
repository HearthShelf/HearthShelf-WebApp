/**
 * Asks once per device whether this is a shared screen (a car, a family
 * tablet), and if so offers to remember the current account + set a PIN in one
 * step. Mounted once in AppShell so it fires shortly after a fresh sign-in.
 *
 * Detection reuses isCarBrowser() - a Tesla-ish UA or a touch-only Tesla-sized
 * panel is a strong shared-device signal. This is a courtesy prompt, not a
 * gate: declining just skips remembering, the app works identically either way.
 *
 * Split into a presentational card (SharedDevicePromptCard, driveable with
 * plain props for the /dev/shared-prompt harness) and this container, which
 * wires up Clerk + the device/roster stores and decides whether to show it.
 */
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useUser } from '@clerk/clerk-react'
import { Icon } from '@/components/common/Icon'
import { isCarBrowser } from '@/hooks/useCarMode'
import { useDeviceSettings } from '@/store/deviceSettings'
import { useRememberedAccounts } from '@/store/rememberedAccounts'
import { rememberCurrentUser } from '@/api/controlPlane'

export type SharedPromptStep = 'ask' | 'pin'

export interface SharedDevicePromptCardProps {
  name: string
  step: SharedPromptStep
  busy?: boolean
  pin: string
  onPinChange: (pin: string) => void
  onNo: () => void
  onYes: () => void
  onSkipPin: () => void
  onSavePin: () => void
}

/** Pure presentational card - no Clerk/store dependency, safe to preview directly. */
export function SharedDevicePromptCard({
  name,
  step,
  busy,
  pin,
  onPinChange,
  onNo,
  onYes,
  onSkipPin,
  onSavePin,
}: SharedDevicePromptCardProps) {
  return (
    <div className="pin-scrim open">
      <div className="pin-card" style={{ maxWidth: 380 }}>
        {step === 'ask' && (
          <>
            <div className="pin-who">
              <Icon name="devices" style={{ fontSize: 40, color: 'var(--text-muted)' }} />
              <div className="pin-title">Is this a shared screen?</div>
            </div>
            <p className="t-muted" style={{ textAlign: 'center', marginBottom: 20 }}>
              A car display or family tablet, for example. We can remember accounts
              here so anyone can switch without signing in each time.
            </p>
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button
                className="pin-key"
                style={{ flex: 1, aspectRatio: 'auto', borderRadius: 12, padding: '12px' }}
                onClick={onNo}
              >
                No
              </button>
              <button
                className="pin-key"
                style={{
                  flex: 1,
                  aspectRatio: 'auto',
                  borderRadius: 12,
                  padding: '12px',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
                onClick={onYes}
              >
                Yes
              </button>
            </div>
          </>
        )}

        {step === 'pin' && (
          <>
            <div className="pin-who">
              <Icon name="lock" style={{ fontSize: 40, color: 'var(--text-muted)' }} />
              <div className="pin-title">Set a PIN? (optional)</div>
            </div>
            <p className="t-muted" style={{ textAlign: 'center', marginBottom: 12 }}>
              A 4-digit PIN keeps {name}'s account private on this shared screen.
              You can skip this and remember the account with no PIN.
            </p>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(e) => onPinChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-digit PIN"
              className="pin-input"
              style={{
                width: '100%',
                textAlign: 'center',
                fontSize: 20,
                letterSpacing: '0.4em',
                padding: '10px',
                marginBottom: 16,
                borderRadius: 10,
                border: '1px solid var(--hairline)',
                background: 'var(--fill)',
                color: 'var(--text)',
              }}
            />
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button
                className="pin-key"
                style={{ flex: 1, aspectRatio: 'auto', borderRadius: 12, padding: '12px' }}
                disabled={busy}
                onClick={onSkipPin}
              >
                Skip PIN
              </button>
              <button
                className="pin-key"
                style={{
                  flex: 1,
                  aspectRatio: 'auto',
                  borderRadius: 12,
                  padding: '12px',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
                disabled={busy || pin.length !== 4}
                onClick={onSavePin}
              >
                Save PIN
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function SharedDevicePrompt() {
  const { user, isLoaded } = useUser()
  const askedSharedDevice = useDeviceSettings((s) => s.askedSharedDevice)
  const markAsked = useDeviceSettings((s) => s.markAskedSharedDevice)
  const accounts = useRememberedAccounts((s) => s.accounts)
  const remember = useRememberedAccounts((s) => s.remember)

  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<SharedPromptStep>('ask')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isLoaded || !user || askedSharedDevice) return
    if (accounts.some((a) => a.userId === user.id)) return // already remembered here
    if (!isCarBrowser()) return
    setVisible(true)
  }, [isLoaded, user, askedSharedDevice, accounts])

  const name = user?.username || user?.firstName || user?.primaryEmailAddress?.emailAddress || '?'

  const finish = useCallback(() => {
    markAsked()
    setVisible(false)
  }, [markAsked])

  const rememberWithPin = useCallback(
    async (pinValue?: string) => {
      if (!user) return
      setBusy(true)
      try {
        const res = await rememberCurrentUser({
          pin: pinValue,
          label: name,
          imageUrl: user.imageUrl,
        })
        remember({
          handle: res.handle,
          userId: user.id,
          label: res.label,
          imageUrl: user.imageUrl,
          hasPin: res.has_pin,
        })
      } finally {
        setBusy(false)
        finish()
      }
    },
    [user, name, remember, finish]
  )

  if (!visible) return null

  return createPortal(
    <SharedDevicePromptCard
      name={name}
      step={step}
      busy={busy}
      pin={pin}
      onPinChange={setPin}
      onNo={finish}
      onYes={() => setStep('pin')}
      onSkipPin={() => void rememberWithPin(undefined)}
      onSavePin={() => void rememberWithPin(pin)}
    />,
    document.body
  )
}
