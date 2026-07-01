/**
 * A HearthShelf server the signed-in user has linked to their account.
 *
 * In production this list comes from the control plane (CF Worker): it
 * answers "which servers is this Clerk identity linked to?" and, per server,
 * brokers a short-lived signed grant the client redeems with the HS server
 * directly. None of that lives here yet - see ARCHITECTURE.md.
 */
export interface LinkedServer {
  /** Stable server identity (HS `server_identity` UUID), not the URL. */
  id: string
  /** Display name the user gave this server. */
  name: string
  /** Public base URL of the HS gateway (NOT the internal ABS). */
  url: string
  /** Last known reachability, surfaced in the picker. */
  status: 'online' | 'offline' | 'unknown'
  /** Optional owner/role hint for UI affordances. */
  role?: 'admin' | 'user'
  /** The user's chosen default server - a fresh device auto-connects here.
   *  At most one linked server is the default. */
  isDefault?: boolean
}
