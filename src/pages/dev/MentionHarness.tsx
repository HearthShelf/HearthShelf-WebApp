/**
 * DEV-ONLY harness for the @mention composer and the notification settings
 * panel, at /dev/mention. Both need a signed-in session and a club with members
 * to reach normally, which makes a styling or keyboard-interaction tweak slow to
 * check; this mounts the real components against a fixed roster instead.
 *
 * The roster deliberately includes "ann" and "ann marie" (one name a prefix of
 * the other) and a "Me" entry that must never be offered.
 */
import { useState } from 'react'
import { MentionInput, type MentionCandidate } from '@/components/social/MentionInput'
import { Icon } from '@/components/common/Icon'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import type { AbsTarget } from '@/api/absLibrary'

const TARGET = { serverId: 'dev', serverUrl: 'http://localhost:0' } as unknown as AbsTarget

const MEMBERS: MentionCandidate[] = [
  { userId: 'u1', username: 'ann' },
  { userId: 'u2', username: 'ann marie' },
  { userId: 'u3', username: 'Bob' },
  { userId: 'u4', username: 'carol' },
  { userId: 'me', username: 'Me' },
]

export function MentionHarness() {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<MentionCandidate[]>([])

  return (
    <div style={{ padding: 24, display: 'grid', gap: 32, maxWidth: 720 }}>
      <section>
        <h2>MentionInput</h2>
        <div style={{ marginTop: 120 }}>
          <MentionInput
            value={text}
            onChange={setText}
            onMention={(m) =>
              setPicked((p) => (p.some((x) => x.userId === m.userId) ? p : [...p, m]))
            }
            members={MEMBERS}
            target={TARGET}
            meId="me"
            placeholder="Type @ to mention someone…"
          />
        </div>
        <pre data-testid="state" style={{ fontSize: 12, marginTop: 12 }}>
          {JSON.stringify({ text, picked: picked.map((p) => p.username) }, null, 2)}
        </pre>
      </section>
      <section>
        <h2>Notification bell (badge must sit in the corner, not cover the glyph)</h2>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {[0, 3, 128].map((n) => (
            <div className="notification-bell" key={n}>
              <button type="button" className="ab-ico notification-bell-button">
                <Icon name={n ? 'notifications_active' : 'notifications'} fill={n > 0} />
                {n > 0 && <span className="notification-bell-count">{n > 99 ? '99+' : n}</span>}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Mention highlight + user links</h2>
        <div className="book-club-note-body" style={{ maxWidth: 520 }}>
          <p>
            plain text then{' '}
            <button type="button" className="note-mention">
              <span
                className="hs-avatar note-mention-avatar"
                style={{ background: '#5c7a3e', borderRadius: '50%', display: 'block' }}
              />
              ann marie
            </button>{' '}
            and{' '}
            <button type="button" className="note-mention">
              <span
                className="hs-avatar note-mention-avatar"
                style={{ background: '#3e5c7a', borderRadius: '50%', display: 'block' }}
              />
              Bob
            </button>{' '}
            trailing text that wraps onto the next line to check the baseline sits right when a
            mention lands mid-paragraph.
          </p>
          <p>
            header name:{' '}
            <strong>
              <button type="button" className="user-link">
                carol
              </button>
            </strong>
          </p>
        </div>
      </section>
      <section>
        <h2>Timeline member pins (two readers both at 0%)</h2>
        <div className="book-club-timeline" style={{ maxWidth: 520 }}>
          <div className="book-club-timeline-rail" />
          <div className="book-club-member-track" style={{ height: 2 * 58 + 20 }}>
            {[
              { id: 'u1', name: 'wutname1', row: 0, me: true, pctLabel: '7%' },
              { id: 'u3', name: 'sauceycharms', row: 1, me: false, pctLabel: 'Finished' },
            ].map((m) => (
              <span
                key={m.id}
                className={'book-club-member-pin' + (m.me ? ' me' : '')}
                style={
                  {
                    left: '0%',
                    top: m.row * 58,
                    '--pin-lead': `${m.row * 58 + 8}px`,
                  } as React.CSSProperties
                }
              >
                <span
                  className="hs-avatar"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: '#7a5c3e',
                    display: 'block',
                  }}
                />
                <span className="book-club-member-pin-name user-link">{m.name}</span>
                <span className="book-club-member-pin-pct">{m.pctLabel}</span>
              </span>
            ))}
          </div>
        </div>
      </section>
      <section>
        <h2>Queue reorder controls</h2>
        <div className="book-club-queue" style={{ maxWidth: 420 }}>
          {['First book', 'Second book', 'Third book'].map((t, i, a) => (
            <div className="book-club-queue-row" key={t}>
              <span className="book-club-queue-number">{i + 1}</span>
              <span />
              <span>
                <strong>{t}</strong>
                <small>An author</small>
              </span>
              <span className="book-club-queue-reorder">
                <button type="button" className="ab-ico" disabled={i === 0}>
                  <Icon name="arrow_upward" />
                </button>
                <button type="button" className="ab-ico" disabled={i === a.length - 1}>
                  <Icon name="arrow_downward" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>NotificationSettings</h2>
        <NotificationSettings />
      </section>
    </div>
  )
}
