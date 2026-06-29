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
export type Theme = 'dark' | 'flat' | 'light' | 'oled'
export type AccentMode = 'dynamic' | 'manual'
export type CoverStyle = 'floating' | 'cards'

// The default hearth ember accent (matches tokens.css --primary).
export const EMBER = '#e0654a'

export interface AccentPreset {
  name: string
  hex: string
}

// Ported from the self-hosted settings store (prototype/data.js PRESETS).
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Ember', hex: '#ea9648' },
  { name: 'Hearth', hex: '#e0654a' },
  { name: 'Cinder', hex: '#c4463a' },
  { name: 'Amber', hex: '#e8b54a' },
  { name: 'Sage', hex: '#7fa86b' },
  { name: 'Tide', hex: '#4f9db0' },
  { name: 'Dusk', hex: '#5e76c4' },
  { name: 'Plum', hex: '#9b6fb8' },
  { name: 'Rose', hex: '#d2689a' },
  { name: 'Slate', hex: '#6b7280' },
]

// Readable ink/cream over an accent hex, chosen by relative luminance. Ported
// from the self-hosted store (prototype/components.jsx onColor).
export function onColor(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.42 ? '#1a1509' : '#fff'
}

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
  // Appearance
  theme: Theme
  accentMode: AccentMode
  accentHex: string
  coverStyle: CoverStyle

  // Playback
  scrubber: ScrubberScope
  skipForward: number
  skipBack: number
  hearthBgPlayer: boolean

  // Queue
  queueMode: QueueMode
  queueAutoRules: AutoRulePref[]

  // Library
  // Pull Home's shelves + in-progress from every library at once (only takes
  // effect when the server has more than one library).
  unifiedHome: boolean

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
      theme: 'dark',
      accentMode: 'manual',
      accentHex: EMBER,
      coverStyle: 'floating',

      scrubber: 'chapter',
      skipForward: 30,
      skipBack: 15,
      hearthBgPlayer: false,

      queueMode: 'manual',
      queueAutoRules: DEFAULT_AUTO_RULE_PREFS,

      unifiedHome: false,

      sleepRewindSec: 30,
      chapterBarrier: true,
      sleepFade: true,
      sleepFadeLen: 20,

      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: 'hearthshelf:settings' }
  )
)
