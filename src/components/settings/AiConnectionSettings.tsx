import { useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/ui/Button'
import { MCP_URL } from '@/lib/config'

/**
 * "Connect an AI app" - the setup surface for the HearthShelf MCP server.
 *
 * WHY THIS IS COPY-AND-GO RATHER THAN A TRUE ONE-CLICK BUTTON: AI clients do not
 * (as of writing) expose a deeplink that pre-fills a custom connector's URL.
 * Claude's documented path is Settings > Connectors > Add custom connector >
 * paste the URL. So the most we can remove is the *finding* and *typing*: this
 * puts the exact URL one click away on the clipboard and links straight to the
 * right settings screen. Everything after that - sign-in, consent, tokens - is
 * handled by OAuth and needs no user input.
 *
 * If a client ever ships an install deeplink, this is the one place to add it.
 */

const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors'

export function AiConnectionSettings() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The URL is
      // visible and selectable on screen, so the user can still copy it by hand.
      setCopied(false)
    }
  }

  return (
    <section>
      <div className="section-head">
        <Icon name="smart_toy" />
        <h2>AI apps</h2>
      </div>

      <div className="cfg-card">
        <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
          <Icon name="auto_awesome" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Talk to an AI app about your books</div>
            <div className="cl-d">
              Connect Claude (or any app that supports MCP) to your library, then ask things like
              "would I like this book?", "what should I read next?" or "do I already own this?". It
              can read your library, reading history and stats - it cannot change, delete or upload
              anything.
            </div>
          </div>
        </div>

        <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
          <Icon name="link" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="cl-t">Your connection address</div>
            <div className="cl-d" style={{ marginBottom: '.5rem' }}>
              Paste this into your AI app when it asks for a custom connector or MCP server address.
            </div>
            <code
              style={{
                display: 'block',
                padding: '.55rem .7rem',
                background: 'var(--surface-2, rgb(0 0 0 / .18))',
                borderRadius: '.5rem',
                fontSize: '.85rem',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {MCP_URL}
            </code>
          </div>
          <Button onClick={copy} aria-label="Copy connection address">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="cfg-card" style={{ marginTop: '.75rem' }}>
        <div className="cfg-line" style={{ alignItems: 'flex-start' }}>
          <Icon name="checklist" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Setting it up in Claude</div>
            <div className="cl-d">
              <ol style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', lineHeight: 1.8 }}>
                <li>Copy the address above.</li>
                <li>
                  Open{' '}
                  <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noreferrer noopener">
                    Claude's connector settings
                  </a>
                  .
                </li>
                <li>Choose "Add custom connector" and paste the address.</li>
                <li>Sign in with HearthShelf and press Connect.</li>
              </ol>
              <p style={{ margin: '.7rem 0 0' }}>
                Custom connectors need a Claude Pro, Max, Team or Enterprise plan. Other MCP-capable
                apps work the same way with the same address.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
