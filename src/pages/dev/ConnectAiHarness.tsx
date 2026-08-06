import { ConnectAiPage } from '@/pages/ConnectAiPage'

// DEV-ONLY visual harness for the AI-connect bounce (/connect-ai). The real
// route sits behind RequireAuth and needs a Clerk session, which production
// Clerk keys refuse to issue on localhost - so this renders the page's
// no-session branches directly.
//
// Append query params to exercise each state:
//   /dev/connect-ai                       -> missing state (error card)
//   /dev/connect-ai?mcp_state=x           -> missing/!allowed callback (error card)
//   /dev/connect-ai?mcp_state=x&mcp_callback=https://evil.example/cb
//                                         -> rejected callback origin (error card)
// Gated to import.meta.env.DEV in the router - never reachable in production.
export function ConnectAiHarness() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <ConnectAiPage />
    </div>
  )
}
