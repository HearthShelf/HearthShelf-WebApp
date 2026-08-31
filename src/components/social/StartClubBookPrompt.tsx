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
 * What happens to the book leaving the current slot when the club starts a new
 * one: the club read it to the end, or it is being shelved unread. Null means
 * the user backed out and nothing should happen.
 */
export type OutgoingChoice = 'finished' | 'set-aside' | null

interface StartPromptCtx {
  /**
   * Ask what becomes of `outgoingTitle` before starting `nextTitle`. Resolves
   * null if the user dismisses, so the caller starts nothing.
   */
  promptStart: (opts: { nextTitle: string; outgoingTitle: string }) => Promise<OutgoingChoice>
}

const Ctx = createContext<StartPromptCtx | null>(null)

interface PromptState {
  nextTitle: string
  outgoingTitle: string
}

/**
 * Hosts the "what happened to the book you're replacing?" prompt. This is a
 * three-way choice, so it cannot use ConfirmProvider's yes/no: the two outcomes
 * are both real actions and dismissing must do neither. The old window.confirm
 * here mapped Cancel onto "set aside", which silently shelved a book whenever
 * someone pressed Escape.
 */
export function StartClubBookPromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromptState | null>(null)
  // Keep the latest resolver reachable from the modal's callbacks.
  const pending = useRef<((c: OutgoingChoice) => void) | null>(null)

  const promptStart = useCallback((opts: { nextTitle: string; outgoingTitle: string }) => {
    return new Promise<OutgoingChoice>((resolve) => {
      pending.current = resolve
      setState(opts)
    })
  }, [])

  const settle = useCallback((choice: OutgoingChoice) => {
    pending.current?.(choice)
    pending.current = null
    setState(null)
  }, [])

  const value = useMemo<StartPromptCtx>(() => ({ promptStart }), [promptStart])

  return (
    <Ctx.Provider value={value}>
      {children}
      {state && (
        <Modal
          title={`Start ${state.nextTitle || 'this book'}?`}
          onClose={() => settle(null)}
          foot={
            <>
              <button className="btn" onClick={() => settle(null)}>
                Cancel
              </button>
              <button className="btn" onClick={() => settle('set-aside')}>
                <Icon name="bookmark" /> Set aside
              </button>
              <button className="btn btn-primary" onClick={() => settle('finished')}>
                <Icon name="check" /> We finished it
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            First, what happened to <strong>{state.outgoingTitle || 'the current book'}</strong>?
          </p>
          <p className="t-muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>
            <strong>We finished it</strong> moves it to Past reads with its discussion.{' '}
            <strong>Set aside</strong> shelves it unread so the club can come back to it later.
          </p>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

export function useStartClubBookPrompt(): StartPromptCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStartClubBookPrompt must be used within StartClubBookPromptProvider')
  return ctx
}
