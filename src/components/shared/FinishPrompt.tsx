import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'

/**
 * Resolves with the chosen completion time, or null for "Now" (let the server
 * stamp the current time). Rejects/resolves-null on cancel so callers can bail.
 */
type FinishChoice = { finishedAt: number | null } | null

interface FinishPromptCtx {
  /**
   * Ask the user when they finished, then resolve with the choice. `count` (for
   * bulk actions) tunes the copy. Resolves null if the user dismisses.
   */
  promptFinish: (opts?: { count?: number }) => Promise<FinishChoice>
}

const Ctx = createContext<FinishPromptCtx | null>(null)

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface PromptState {
  count: number
  resolve: (c: FinishChoice) => void
}

/**
 * Hosts the shared "When did you finish this?" prompt. Marking a book finished
 * routes through this instead of stamping the current time, so a backdated
 * completion lands in the right bucket for year/listening stats.
 */
export function FinishPromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromptState | null>(null)
  // Keep the latest resolver reachable from the modal's callbacks.
  const pending = useRef<((c: FinishChoice) => void) | null>(null)

  const promptFinish = useCallback((opts?: { count?: number }) => {
    return new Promise<FinishChoice>((resolve) => {
      pending.current = resolve
      setState({ count: opts?.count ?? 1, resolve })
    })
  }, [])

  const settle = useCallback((choice: FinishChoice) => {
    pending.current?.(choice)
    pending.current = null
    setState(null)
  }, [])

  const value = useMemo<FinishPromptCtx>(() => ({ promptFinish }), [promptFinish])

  return (
    <Ctx.Provider value={value}>
      {children}
      {state && <FinishModal count={state.count} onSettle={settle} />}
    </Ctx.Provider>
  )
}

export function useFinishPrompt(): FinishPromptCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFinishPrompt must be used within FinishPromptProvider')
  return ctx
}

function FinishModal({ count, onSettle }: { count: number; onSettle: (c: FinishChoice) => void }) {
  // Seed to the current month/year. new Date() here is fine - this is a user
  // action, not render-pure code.
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  const years: number[] = []
  for (let y = now.getFullYear(); y >= now.getFullYear() - 15; y--) years.push(y)

  const many = count > 1
  const title = many ? `When did you finish these ${count} books?` : 'When did you finish this?'

  const confirmPicked = () => {
    // Start of the chosen month, local time. Clamp to "now" if the user picked
    // the current month/year so we never stamp a future instant.
    const picked = new Date(year, month, 1, 12, 0, 0, 0).getTime()
    const finishedAt = Math.min(picked, Date.now())
    onSettle({ finishedAt })
  }

  return (
    <Modal
      title={title}
      onClose={() => onSettle(null)}
      foot={
        <>
          <button className="btn" onClick={() => onSettle({ finishedAt: null })}>
            <Icon name="schedule" /> Now
          </button>
          <button className="btn btn-primary" onClick={confirmPicked}>
            <Icon name="check" /> Done
          </button>
        </>
      }
    >
      <p className="t-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Backdating keeps your listening stats accurate. Pick the month you finished, or tap Now.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <select
          className="fld"
          style={{ flex: 2 }}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Month finished"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select
          className="fld"
          style={{ flex: 1 }}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Year finished"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  )
}
