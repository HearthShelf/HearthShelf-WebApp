/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  readonly VITE_CONTROL_PLANE_URL?: string
  // Clerk redirect config (read implicitly by the Clerk SDK).
  readonly VITE_CLERK_SIGN_IN_URL?: string
  readonly VITE_CLERK_SIGN_UP_URL?: string
  readonly VITE_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL?: string
  readonly VITE_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Baked in by vite.config.ts's `define` at build time.
declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string
