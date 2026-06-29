import { useEffect } from 'react'
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
 * The accent is a fixed, user-chosen colour (default ember). Ported from the
 * self-hosted useApplySettings; the cover-art glow sampling lives in the
 * full-screen player here, so this hook only owns theme + accent.
 */
export function useApplySettings() {
  const theme = useSettingsStore((s) => s.theme)
  const accentHex = useSettingsStore((s) => s.accentHex)

  const effectiveAccent = accentHex || EMBER

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.setProperty('--accent', effectiveAccent)
    root.style.setProperty('--primary', effectiveAccent)
    root.style.setProperty('--on-accent', onColor(effectiveAccent))
    root.style.setProperty('--primary-foreground', onColor(effectiveAccent))
  }, [theme, effectiveAccent])
}
