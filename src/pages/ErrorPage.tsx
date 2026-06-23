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

  const isNotFound = isRouteErrorResponse(error) && error.status === 404
  const code = isRouteErrorResponse(error) ? error.status : 404
  const title = isNotFound ? 'Page not found' : 'Something went wrong'
  const message = isNotFound
    ? "This shelf is empty. The page you're looking for doesn't exist or has been moved."
    : 'Something went wrong. An unexpected error occurred while loading this page.'

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
