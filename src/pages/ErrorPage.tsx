import { useNavigate, useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import hearthBg from '@/assets/img/SittingInTheHearth.webp'

/**
 * The front door's error + 404 screen. Mirrors the main HearthShelf app: the
 * SittingInTheHearth backdrop under a dark scrim, a hearth-gold code, a
 * shelf-cream heading, and calm copy.
 */
export function ErrorPage() {
  const navigate = useNavigate()
  const error = useRouteError()

  // A real 404 is a route Response with status 404. A THROWN error (a page that
  // crashed while rendering) is NOT a Response - it must not masquerade as a 404,
  // or a render bug looks like a missing page. Show it as an error with detail.
  const isNotFound = isRouteErrorResponse(error) && error.status === 404
  const code = isRouteErrorResponse(error) ? error.status : 'Error'
  const title = isNotFound ? 'Page not found' : 'Something went wrong'
  const message = isNotFound
    ? "This shelf is empty. The page you're looking for doesn't exist or has been moved."
    : 'Something went wrong while loading this page.'
  // Surface the real error text (helps diagnose a crashed page, on any device).
  const detail =
    !isNotFound && error
      ? error instanceof Error
        ? error.message
        : isRouteErrorResponse(error)
          ? `${error.status} ${error.statusText}`
          : String(error)
      : null

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${hearthBg})` }}
      />
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
        <p className="text-7xl font-bold leading-none text-[var(--brand-hearth)]">{code}</p>
        <div className="flex flex-col gap-2">
          <h1 className="t-wordmark text-2xl text-[var(--brand-shelf)]">{title}</h1>
          <p className="max-w-xs text-sm text-white/60">{message}</p>
          {detail && (
            <p className="mx-auto mt-1 max-w-xs break-words font-mono text-[11px] text-white/40">
              {detail}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Button onClick={() => navigate('/')}>Go home</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    </div>
  )
}
