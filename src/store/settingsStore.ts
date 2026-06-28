import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'

// The default order/priority of the Auto-queue rules. All on by default.
export const DEFAULT_AUTO_RULES: AutoRuleId[] = [
  'finish-series',
  'in-progress',
  'new-in-series',
]

export type ScrubberScope = 'chapter' | 'book'

// An Auto-queue rule with its enabled flag. The array order is the priority.
export interface AutoRulePref {
  id: AutoRuleId
  on: boolean
}

export const DEFAULT_AUTO_RULE_PREFS: AutoRulePref[] = DEFAULT_AUTO_RULES.map(
  (id) => ({ id, on: true })
)

// Minimal client-only player preferences the full-screen player reads. Persisted
// to localStorage; no ABS dependency. This is a focused subset of the self-hosted
// app's settings store - only the fields the player UI actually touches.
export interface SettingsState {
  // Playback
  scrubber: ScrubberScope
  skipForward: number
  skipBack: number
  hearthBgPlayer: boolean

  // Queue
  queueMode: QueueMode
  queueAutoRules: AutoRulePref[]

  // Sleep (stop-sequence behaviour, mirrored by useSleepTimer)
  sleepRewindSec: number
  chapterBarrier: boolean
  sleepFade: boolean
  sleepFadeLen: number

  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
}

type SettingsValues = Omit<SettingsState, 'set'>

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      scrubber: 'chapter',
      skipForward: 30,
      skipBack: 15,
      hearthBgPlayer: false,

      queueMode: 'manual',
      queueAutoRules: DEFAULT_AUTO_RULE_PREFS,

      sleepRewindSec: 30,
      chapterBarrier: true,
      sleepFade: true,
      sleepFadeLen: 20,

      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: 'hearthshelf:settings' }
  )
)
