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
        <h2>NotificationSettings</h2>
        <NotificationSettings />
      </section>
    </div>
  )
}
