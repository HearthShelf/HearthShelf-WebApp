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

export interface ConfirmOptions {
  title: string
  message: string
  /** Label on the confirming button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Style the confirming button as destructive (red). */
  danger?: boolean
}

interface ConfirmCtx {
  /** Ask the user to confirm, resolving true only if they accept. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const Ctx = createContext<ConfirmCtx | null>(null)

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/**
 * Hosts the shared confirmation dialog, so destructive actions can await a
 * yes/no instead of firing on the first click. Same promise-modal shape as
 * FinishPromptProvider.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  // Keep the latest resolver reachable from the modal's callbacks.
  const pending = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      pending.current = resolve
      setState({ ...opts, resolve })
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    pending.current?.(ok)
    pending.current = null
    setState(null)
  }, [])

  const value = useMemo<ConfirmCtx>(() => ({ confirm }), [confirm])

  return (
    <Ctx.Provider value={value}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => settle(false)}
          foot={
            <>
              <button className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                className={'btn ' + (state.danger ? 'btn-danger' : 'btn-primary')}
                onClick={() => settle(true)}
              >
                <Icon name="check" /> {state.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>{state.message}</p>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

export function useConfirm(): ConfirmCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
