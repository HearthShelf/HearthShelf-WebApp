import { toast } from 'sonner'

/**
 * Thin wrapper over Sonner so call sites have one consistent vocabulary and we
 * can tune durations/behaviour in one place. Errors linger longer than successes
 * (a failure the user misses is worse than a success they miss).
 */
export const notify = {
  success(message: string) {
    toast.success(message)
  },
  error(message: string) {
    toast.error(message, { duration: 6000 })
  },
  info(message: string) {
    toast(message)
  },
  /** Pull a human message out of an unknown thrown value. */
  fromError(err: unknown, fallback = 'Something went wrong'): string {
    return err instanceof Error && err.message ? err.message : fallback
  },
}
