/**
 * Brand marks for the sign-in providers, plus the passkey and email glyphs.
 *
 * Inline SVG rather than an icon font or remote asset: these render on the very
 * first paint of the sign-in page, before anything else has loaded, and the
 * social marks have brand colors that must survive both themes untouched.
 *
 * Each path is the vendor's own mark, drawn on a 24x24 grid so every button's
 * icon slot is the same size. Only the passkey and email glyphs take
 * `currentColor` - the social marks keep their brand colors, which is what the
 * providers' brand guidelines require.
 */
type IconProps = { className?: string }

const BOX = {
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  'aria-hidden': true,
  focusable: false,
} as const

export function GoogleIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.26a12 12 0 0 0 0 10.76l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

export function AppleIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path
        fill="currentColor"
        d="M17.05 12.74c-.03-2.66 2.17-3.94 2.27-4-1.24-1.81-3.16-2.06-3.85-2.09-1.64-.17-3.2.96-4.03.96-.83 0-2.11-.94-3.47-.91-1.79.03-3.44 1.04-4.36 2.64-1.86 3.22-.47 7.99 1.33 10.6.88 1.28 1.93 2.71 3.31 2.66 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.06.86 3.46.83 1.43-.02 2.34-1.3 3.21-2.59 1.01-1.48 1.43-2.92 1.45-3-.03-.01-2.78-1.07-2.81-4.24ZM14.4 4.9c.73-.89 1.23-2.12 1.09-3.35-1.06.04-2.34.7-3.1 1.59-.68.78-1.27 2.04-1.11 3.24 1.18.09 2.39-.6 3.12-1.48Z"
      />
    </svg>
  )
}

export function DiscordIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path
        fill="#5865F2"
        d="M20.32 4.56A19.8 19.8 0 0 0 15.43 3l-.24.45c-.9.19-1.77.47-2.6.83a17.9 17.9 0 0 0-2.6-.83L9.75 3a19.8 19.8 0 0 0-4.9 1.56C1.76 9.18.92 13.68 1.34 18.11A19.94 19.94 0 0 0 7.4 21.2l.6-1.3.63-1.33c-.7-.26-1.36-.58-1.99-.96l.49-.38a14.24 14.24 0 0 0 12.12 0l.49.38c-.63.38-1.3.7-1.99.96l.63 1.33.6 1.3a19.9 19.9 0 0 0 6.05-3.09c.5-5.13-.83-9.6-3.42-13.55h-.29ZM8.5 15.4c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43s2.17 1.1 2.15 2.43c0 1.33-.95 2.42-2.15 2.42Zm7.94 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43s2.16 1.1 2.14 2.43c0 1.33-.94 2.42-2.14 2.42Z"
      />
    </svg>
  )
}

export function PasskeyIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path
        fill="currentColor"
        d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0 1.5c2.8 0 5.4 1.13 6.6 2.8-.38.5-.6 1.11-.6 1.78V21H1v-2.25c0-3.2 5.34-6.25 8-6.25Z"
      />
      <path
        fill="currentColor"
        d="M18.5 8a3.5 3.5 0 0 1 1.5 6.66V16l1 1-1 1 1 1-1.5 1.5-1.5-1.5v-4.34A3.5 3.5 0 0 1 18.5 8Zm0 2a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
    </svg>
  )
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 6.5h18v11H3zM3 7l9 6 9-6"
      />
    </svg>
  )
}
