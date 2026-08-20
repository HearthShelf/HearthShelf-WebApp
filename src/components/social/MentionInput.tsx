import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Avatar } from '@/components/common/Avatar'
import type { AbsTarget } from '@/api/absLibrary'

const MAX_SUGGESTIONS = 6

export interface MentionCandidate {
  userId: string
  username: string
}

/**
 * A textarea that offers club members after an `@`.
 *
 * The selected ids are reported alongside the text rather than re-derived from
 * it: a username can change, contain spaces, or be a prefix of another, so
 * "whoever the writer actually picked" is the only reliable record. The server
 * still authorizes every id against club membership - this is convenience, not
 * a permission boundary.
 *
 * Interaction mirrors SuggestChips (arrow keys with wrap, Enter to commit,
 * Escape to dismiss, and the `picking` ref that keeps blur from swallowing a
 * click on a suggestion), but has to track the caret because an @ can start
 * anywhere in a sentence, not just at the end.
 */
export function MentionInput({
  value,
  onChange,
  onMention,
  members,
  target,
  meId,
  placeholder,
  rows = 3,
  autoFocus,
}: {
  value: string
  onChange: (text: string) => void
  /** Called when a member is picked from the list. */
  onMention: (member: MentionCandidate) => void
  members: MentionCandidate[]
  target: AbsTarget
  meId?: string
  placeholder?: string
  rows?: number
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const picking = useRef(false)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  // The '@…' being typed immediately before the caret, if any. Bounded by
  // whitespace so an email address never opens the picker, and capped in length
  // so a stray '@' early in a long note stops matching once it can't be a name.
  const query = useMemo(() => {
    if (dismissed) return null
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return null
    const before = upto[at - 1]
    if (before !== undefined && !/\s|[([]/.test(before)) return null
    const text = upto.slice(at + 1)
    // Allow one space so "@ann marie" keeps matching, but stop at a second.
    if (/\n/.test(text) || (text.match(/ /g)?.length ?? 0) > 1) return null
    return { at, text }
  }, [value, caret, dismissed])

  const matches = useMemo(() => {
    if (!query) return []
    const q = query.text.trim().toLowerCase()
    return members
      .filter((m) => m.userId && m.userId !== meId)
      .filter((m) => !q || m.username.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [query, members, meId])

  const open = matches.length > 0

  const commit = (member: MentionCandidate) => {
    if (!query) return
    const head = value.slice(0, query.at)
    const tail = value.slice(caret)
    // A trailing space lets the writer keep typing without re-opening the list.
    const inserted = `@${member.username} `
    const next = head + inserted + tail
    onChange(next)
    onMention(member)
    setDismissed(true)
    setActive(0)
    const pos = head.length + inserted.length
    // Restore the caret after React re-renders with the new value, or it jumps
    // to the end and a mid-sentence mention becomes unusable.
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const sync = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? 0)

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((i) => (i + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && matches[active]) {
        event.preventDefault()
        commit(matches[active])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(true)
        return
      }
    }
    // Any other key resumes matching - a dismissal only hides the current list.
    if (dismissed && event.key !== 'Shift') setDismissed(false)
  }

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDismissed(false)
    onChange(event.target.value)
    sync(event.target)
  }

  return (
    <div className="suggest-wrap mention-wrap">
      <textarea
        ref={ref}
        className="fld"
        rows={rows}
        maxLength={2000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={onInput}
        onKeyDown={onKey}
        onKeyUp={(e) => sync(e.currentTarget)}
        onSelect={(e) => sync(e.currentTarget)}
        onBlur={() => {
          if (!picking.current) setDismissed(true)
        }}
      />
      {open && (
        <div className="suggest-list mention-list" role="listbox" aria-label="Mention a member">
          {matches.map((member, index) => (
            <button
              type="button"
              key={member.userId}
              role="option"
              aria-selected={index === active}
              className={'suggest-item mention-item' + (index === active ? ' on' : '')}
              onMouseDown={() => {
                picking.current = true
              }}
              onMouseUp={() => {
                picking.current = false
              }}
              onClick={() => commit(member)}
            >
              <Avatar
                name={member.username}
                target={target}
                userId={member.userId}
                size={22}
                className="hs-avatar"
              />
              <span>{member.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
