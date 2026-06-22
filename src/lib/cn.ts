/**
 * Minimal className joiner. Falsy values are dropped.
 * Kept dependency-free; swap for clsx + tailwind-merge if variant
 * conflicts start to bite.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
