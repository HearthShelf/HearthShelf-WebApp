import type { ComponentProps } from 'react'
import type { ClerkProvider } from '@clerk/clerk-react'

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>['appearance']>

/**
 * Shared skin for every Clerk-rendered surface (<SignIn />, <SignUp />,
 * <UserButton />). Applied once on <ClerkProvider> so the account experience
 * matches the HearthShelf dark shell instead of Clerk's default white card.
 *
 * Colors are pulled from the design tokens (tokens.css) at runtime via the CSS
 * variables, so a theme flip retints Clerk too. Anything Clerk can't read from
 * a CSS var (it wants concrete color strings) mirrors the .dark token values.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: '#e0654a', // --primary (ember accent)
    colorBackground: '#2a2825', // --card
    colorText: '#f4f1ea', // --foreground
    colorTextSecondary: '#aba498', // --muted-foreground
    colorInputBackground: '#1b1a18', // --background
    colorInputText: '#f4f1ea',
    colorDanger: '#e0654a', // --destructive
    colorSuccess: '#7fa86b', // --chart-3
    colorWarning: '#d9a45a',
    colorNeutral: '#f4f1ea',
    borderRadius: '0.75rem', // --radius-md
    fontFamily:
      '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  elements: {
    // The card chrome: warm surface, hairline border, soft lift instead of
    // the default bright-white panel.
    card: 'bg-card border border-border shadow-[0_18px_48px_rgba(0,0,0,0.55)]',
    rootBox: 'w-full',
    cardBox: 'shadow-none',
    headerTitle: 'text-foreground',
    headerSubtitle: 'text-muted-foreground',

    // Primary action (Continue / Sign in).
    formButtonPrimary:
      'bg-primary text-primary-foreground hover:opacity-90 normal-case',

    // Social / OAuth buttons read as secondary surfaces.
    socialButtonsBlockButton:
      'border border-border bg-secondary text-secondary-foreground hover:bg-accent',
    socialButtonsBlockButtonText: 'text-secondary-foreground',

    formFieldInput:
      'bg-input border border-border text-foreground placeholder:text-muted-foreground',
    formFieldLabel: 'text-foreground',

    dividerLine: 'bg-border',
    dividerText: 'text-muted-foreground',

    footerActionText: 'text-muted-foreground',
    footerActionLink: 'text-primary hover:opacity-90',

    // Clerk's free-tier badge sits on a light strip by default.
    footer: 'bg-transparent',

    // <UserButton /> dropdown in the app shell.
    userButtonPopoverCard: 'bg-popover border border-border',
    userButtonPopoverActionButton: 'text-foreground hover:bg-accent',
    userButtonPopoverActionButtonText: 'text-foreground',
    userButtonPopoverFooter: 'bg-transparent',
  },
}
