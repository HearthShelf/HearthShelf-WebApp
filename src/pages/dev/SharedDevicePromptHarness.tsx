import { useState } from 'react'
import { SharedDevicePromptCard, type SharedPromptStep } from '@/components/account/SharedDevicePrompt'

// DEV-ONLY visual harness for the shared-device prompt. Drives the pure
// presentational card directly (no Clerk dependency) so both steps can be
// eyeballed without a real sign-in. Gated to import.meta.env.DEV in the router.
export function SharedDevicePromptHarness() {
  const [step, setStep] = useState<SharedPromptStep>('ask')
  const [pin, setPin] = useState('')
  const [result, setResult] = useState('')

  return (
    <div className="dark" style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <div style={{ position: 'fixed', top: 16, left: 16, color: 'var(--text)', zIndex: 100 }}>
        <p>{result}</p>
        <button className="pin-key" style={{ width: 140, aspectRatio: 'auto', padding: '8px 14px', borderRadius: 10 }} onClick={() => { setStep('ask'); setPin(''); setResult('') }}>
          Reset
        </button>
      </div>
      <SharedDevicePromptCard
        name="Jaime"
        step={step}
        pin={pin}
        onPinChange={setPin}
        onNo={() => setResult('answered: No')}
        onYes={() => setStep('pin')}
        onSkipPin={() => setResult('remembered, no PIN')}
        onSavePin={() => setResult(`remembered with PIN ${pin}`)}
      />
    </div>
  )
}
