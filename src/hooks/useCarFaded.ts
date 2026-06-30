import { useSyncExternalStore } from 'react'

// Whether the car-mode player's chrome is currently faded (idle). Set by
// PlayerPage (the only thing that owns the idle-fade timer, via useIdleFade),
// read by AppShell so the sidebar can fade in step with the rest of the car
// player's chrome instead of being hard-hidden/shown. In-memory only - no
// reason to persist a moment-to-moment idle state across reloads, unlike
// useNavCollapsed's localStorage-backed setting.

const listeners = new Set<() => void>()
let faded = false

function emit() {
  for (const l of listeners) l()
}

export function setCarFaded(next: boolean) {
  if (next === faded) return
  faded = next
  emit()
}

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  get() {
    return faded
  },
}

export function useCarFaded(): boolean {
  return useSyncExternalStore(store.subscribe, store.get, () => false)
}
