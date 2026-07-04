import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'
import type { SettingScope, SettingValue } from '@hearthshelf/core'
import { SETTINGS_CATALOG, settingDefault } from '@hearthshelf/core'

// Client-only player + appearance preferences. Rendered from localStorage for an
// instant first paint, then reconciled per-key with the active server's
// HearthShelf backend (useSettingsSync) so a user's settings follow them across
// devices. The store keeps flat fields as the read surface every component uses,
// and tracks a per-key updatedAt in `meta` so sync merges at the setting level
// (per-key last-writer-wins). The catalog in @hearthshelf/core is the shared
// definition of each key's scope + default.

// The default order/priority of the Auto-queue rules. All on by default.
export const DEFAULT_AUTO_RULES: AutoRuleId[] = ['finish-series', 'in-progress', 'new-in-series']

export type ScrubberScope = 'chapter' | 'book'
export type Theme = 'dark' | 'flat' | 'light' | 'oled'
export type AccentMode = 'dynamic' | 'manual'
export type CoverStyle = 'floating' | 'cards'
export type GlowMode = 'gradient' | 'image'

// Car mode: a big-touch, glance-friendly player for in-car browsers (Tesla).
// 'auto' enables it when a Tesla user-agent is detected; 'on'/'off' force it.
export type CarMode = 'auto' | 'on' | 'off'

// The draggable/resizable car-mode player card, in viewport px. null until the
// user first moves or resizes it. Device-window geometry - stays local (not in
// the catalog, so it never syncs across devices).
export interface CarPlayerRect {
  x: number
  y: number
  w: number
  h: number
}

// The default hearth ember accent (matches tokens.css --primary).
export const EMBER = '#e0654a'

export interface AccentPreset {
  name: string
  hex: string
}

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

// Readable ink/cream over an accent hex, chosen by relative luminance.
export function onColor(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.42 ? '#1a1509' : '#fff'
}

// An Auto-queue rule with its enabled flag. The array order is the priority.
export interface AutoRulePref {
  id: AutoRuleId
  on: boolean
}

export const DEFAULT_AUTO_RULE_PREFS: AutoRulePref[] = DEFAULT_AUTO_RULES.map((id) => ({
  id,
  on: true,
}))

export interface SettingsState {
  // Appearance
  theme: Theme
  accentMode: AccentMode
  accentHex: string
  glow: number
  glowMode: GlowMode
  coverStyle: CoverStyle
  cardBg: boolean
  // Tri-state: null = never chose (default on - Gravatar shows), true/false = the
  // user's own choice. Only written when the toggle is flipped, so no client bakes
  // in a default and the setting stays one account-wide value that syncs.
  useGravatar: boolean | null
  hearthBgPlayer: boolean

  // Social privacy (tri-state: null = never chose, follow the server's
  // community default). See docs/social-stats.md / docs/social.md.
  shareReadBooks: boolean | null
  shareCurrentlyListening: boolean | null

  // Playback
  scrubber: ScrubberScope
  defaultSpeed: number
  skipForward: number
  skipForwardCustom: number
  skipBack: number
  skipBackCustom: number

  // Car mode (in-car browser player)
  carMode: CarMode
  carPlayerRect: CarPlayerRect | null
  carFadeEnabled: boolean
  carFadeSec: number

  // Reveal the Advanced panel (browser/UA diagnostics) on the Account page.
  showAdvanced: boolean

  // Show a toast when playback crosses a club note. Device-scoped so you can
  // silence pops on one device without leaving the club.
  notePops: boolean

  // Remembered Public/Personal choice for the general (non-club) note composer,
  // written on each post. Device-scoped (see docs/social.md).
  noteDefaultVisibility: 'public' | 'personal'

  // Queue
  queueMode: QueueMode
  queueAutoRules: AutoRulePref[]

  // Library
  unifiedHome: boolean

  // Sleep
  sleepRewindSec: number
  chapterBarrier: boolean
  sleepFade: boolean
  sleepFadeLen: number
  autoSleep: boolean
  autoSleepStart: string
  autoSleepEnd: string
  autoSleepDur: number

  // Device-scoped: when false, this device ignores account settings pulled from
  // the server and runs on its local values only (see useSettingsSync).
  useSharedSettings: boolean

  // Per-key updatedAt (ms) for sync conflict resolution. Not a user setting.
  meta: Record<string, number>
  // Stable per-install id for device-scoped settings. Generated once, persisted.
  deviceId: string

  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
  // Apply per-key values pulled from the server with their server updatedAt,
  // resolving each against the local value via last-writer-wins.
  applyServerKeys: (rows: Record<string, { value: SettingValue; updatedAt: number }>) => void
}

type SettingsValues = Omit<SettingsState, 'set' | 'applyServerKeys' | 'meta' | 'deviceId'>

// Keys that sync to the server (present in the catalog). carPlayerRect is
// local-only window geometry, so it's absent from the catalog and never syncs.
export const SYNCED_KEYS = Object.keys(SETTINGS_CATALOG) as (keyof SettingsValues)[]

function newDeviceId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      accentMode: 'manual',
      accentHex: EMBER,
      glow: 60,
      glowMode: 'gradient',
      coverStyle: 'floating',
      cardBg: true,
      useGravatar: null,
      hearthBgPlayer: true,

      shareReadBooks: null,
      shareCurrentlyListening: null,

      scrubber: 'chapter',
      defaultSpeed: 1,
      skipForward: 30,
      skipForwardCustom: 45,
      skipBack: 15,
      skipBackCustom: 20,

      carMode: 'auto',
      carPlayerRect: null,
      carFadeEnabled: true,
      carFadeSec: 30,
      showAdvanced: false,
      notePops: true,
      noteDefaultVisibility: 'public',

      queueMode: 'manual',
      queueAutoRules: DEFAULT_AUTO_RULE_PREFS,

      unifiedHome: false,

      sleepRewindSec: 30,
      chapterBarrier: true,
      sleepFade: true,
      sleepFadeLen: 20,
      autoSleep: false,
      autoSleepStart: '22:00',
      autoSleepEnd: '06:00',
      autoSleepDur: 30,

      useSharedSettings: true,

      meta: {},
      deviceId: newDeviceId(),

      set: (key, value) =>
        set((state) => {
          const meta = { ...state.meta }
          if (key in SETTINGS_CATALOG) meta[key as string] = Date.now()
          return { [key]: value, meta } as Partial<SettingsState>
        }),

      applyServerKeys: (rows) => {
        const state = get()
        const patch: Record<string, unknown> = {}
        const meta = { ...state.meta }
        for (const key of Object.keys(rows)) {
          if (!(key in SETTINGS_CATALOG)) continue
          const remote = rows[key]
          const localAt = state.meta[key] ?? -1
          if (remote.updatedAt >= localAt) {
            patch[key] = remote.value
            meta[key] = remote.updatedAt
          }
        }
        if (Object.keys(patch).length) set({ ...patch, meta } as Partial<SettingsState>)
      },
    }),
    { name: 'hearthshelf:settings' },
  ),
)

// The scope of a synced key from the catalog ('account' | 'device').
export function scopeOf(key: string): SettingScope | null {
  const d = SETTINGS_CATALOG[key]
  return d ? d.scope : null
}

// The catalog default for a key (used when resetting).
export function defaultOf(key: string): SettingValue | undefined {
  return settingDefault(key)
}
