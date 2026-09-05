import { useEffect } from 'react'
import { coverHue } from '@hearthshelf/core'
import { useSettingsStore, onColor, EMBER } from '@/store/settingsStore'

/**
 * Applies the appearance settings to the document root.
 *
 * Theme is driven by the `data-theme` attribute on <html>. The shell ships with
 * class="dark" (the product default); tokens.css defines [data-theme='flat'|
 * 'oled'|'light'] blocks that come AFTER the .dark block, so setting data-theme
 * to one of those overrides the dark palette. data-theme='dark' (or absent)
 * leaves the .dark palette in place, which is the home look.
 *
 * The accent honours `accentMode` (DESIGN.shared.md, "Accent"): 'manual' pins it
 * to the user's chosen hex, 'dynamic' follows the current book's cover hue. Both
 * are account-scoped settings that sync with mobile, so a user who picks dynamic
 * on the phone gets it here too.
 *
 * `nowItemId` is passed in rather than read from the player, so this hook stays
 * free of the player provider (AppShell mounts it outside that tree). Pass the
 * currently-playing item id to make 'dynamic' live; omit it and dynamic falls
 * back to the chosen hex.
 *
 * NOTE: this sets --accent as well as --primary. In shadcn's convention --accent
 * is a neutral hover surface, but ~287 rules in design.css already read
 * var(--accent) as the brand accent, so the override is load-bearing. Renaming
 * that is its own migration, not a side effect of this hook.
 */
export function useApplySettings(nowItemId?: string | null) {
  const theme = useSettingsStore((s) => s.theme)
  const accentMode = useSettingsStore((s) => s.accentMode)
  const accentHex = useSettingsStore((s) => s.accentHex)

  const chosen = accentHex || EMBER
  const effectiveAccent = accentMode === 'dynamic' && nowItemId ? coverHue(nowItemId) : chosen

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.setProperty('--accent', effectiveAccent)
    root.style.setProperty('--primary', effectiveAccent)
    root.style.setProperty('--ring', effectiveAccent)
    root.style.setProperty('--on-accent', onColor(effectiveAccent))
    root.style.setProperty('--primary-foreground', onColor(effectiveAccent))
  }, [theme, effectiveAccent])
}
