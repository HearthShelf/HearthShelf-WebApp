import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'

/**
 * The header's account control: avatar, and a way out.
 *
 * Replaces the previous provider's drop-in user button. Everything that widget
 * offered beyond this - profile editing, passkeys, two-factor - now lives on
 * the Account page, so this stays a link plus a sign-out rather than a second
 * place to manage the same settings.
 */
export function UserMenu() {
  const { user, signOut } = useAuth()
  if (!user) return null

  const label = user.username || user.fullName || user.email
  const initial = (label || '?').charAt(0).toUpperCase()

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/account"
        className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-muted text-sm"
        title={label}
      >
        {user.imageUrl ? (
          <img src={user.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          initial
        )}
      </Link>
      <button
        className="btn-link text-[13px]"
        onClick={() => void signOut({ redirectUrl: '/sign-in?signed_out=1' })}
      >
        Sign out
      </button>
    </div>
  )
}
