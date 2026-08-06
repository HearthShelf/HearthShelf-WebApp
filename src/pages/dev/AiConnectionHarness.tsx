import { AiConnectionSettings } from '@/components/settings/AiConnectionSettings'

// DEV-ONLY visual harness for the "AI apps" settings panel. The real panel lives
// at /account/aiApps behind RequireAuth, and production Clerk keys refuse to
// issue a session on localhost - so this renders it standalone to check layout,
// the copy button, and the setup steps.
// Gated to import.meta.env.DEV in the router - never reachable in production.
export function AiConnectionHarness() {
  return (
    <div
      className="dark"
      style={{ minHeight: '100vh', background: 'var(--background)', padding: 'var(--s6, 1.5rem)' }}
    >
      <div style={{ maxWidth: '48rem', margin: '0 auto' }}>
        <AiConnectionSettings />
      </div>
    </div>
  )
}
