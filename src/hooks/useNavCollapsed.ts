import { useSyncExternalStore } from 'react'

// Whether the desktop sidebar is collapsed to an icon-only rail. Persisted per
// browser and shared across components (AppShell sets the .nav-collapsed class,
// Sidebar renders the toggle) via a tiny external store - the same pattern as
// useMediaQuery, so every caller stays in sync without prop-drilling.

const KEY = 'hs:nav-collapsed'
const listeners = new Set<() => void>()

let collapsed = read()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function emit() {
  for (const l of listeners) l()
}

export function setNavCollapsed(next: boolean) {
  if (next === collapsed) return
  collapsed = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // localStorage unavailable (private mode); the choice just won't persist.
  }
  emit()
}

export function toggleNavCollapsed() {
  setNavCollapsed(!collapsed)
}

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  get() {
    return collapsed
  },
}

export function useNavCollapsed(): boolean {
  return useSyncExternalStore(store.subscribe, store.get, () => false)
}
