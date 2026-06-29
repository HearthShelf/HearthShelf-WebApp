import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getApiKeys,
  getUsers,
  createApiKey,
  deleteApiKey,
  getServiceAccountIds,
  tagServiceAccount,
  adminSectionKeys,
  adminKeys,
  type ABSApiKey,
} from '@/api/absAdmin'
import { getMe } from '@/api/absLibrary'
import { AbsError } from '@/api/absClient'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fmtSessDate } from '@/lib/format'
import { Icon } from '@/components/common/Icon'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Modal } from '@/components/common/Modal'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

// Preset expirations offered in the create dialog (seconds). null = never.
const EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Never', seconds: null },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
  { label: '90 days', seconds: 90 * 24 * 60 * 60 },
  { label: '1 year', seconds: 365 * 24 * 60 * 60 },
]

export function ConfigApiKeys() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [expiryIdx, setExpiryIdx] = useState(0)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<ABSApiKey | null>(null)
  // When set, the new key's owner gets tagged as a service account after create.
  const [asServiceAccount, setAsServiceAccount] = useState(false)
  // Bumped after tagging so the local (localStorage-backed) service-account set
  // is re-read - it has no query to invalidate.
  const [tagBump, setTagBump] = useState(0)
  // Keys owned by tagged service accounts are hidden by default - they're
  // managed on the Service Accounts page and would just clutter this list.
  const [showServiceKeys, setShowServiceKeys] = useState(false)

  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminSectionKeys.apiKeys(target?.serverId ?? ''),
    queryFn: () => getApiKeys(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Users power the owner picker and let the table label keys whose owner ABS
  // didn't embed (older keys, or a slimmer list response).
  const { data: usersData } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const allKeys = data?.apiKeys ?? []
  const users = useMemo(
    () => (usersData?.users ?? []).filter((u) => u.type !== 'guest'),
    [usersData]
  )
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  // Service accounts are tagged locally per server (no Node backend on the
  // WebApp data path); their keys are grouped on the Service Accounts page.
  const serviceUserIds = useMemo(
    () => new Set(target ? getServiceAccountIds(target) : []),
    // tagBump forces a re-read after we tag a new owner (no query to invalidate).
    [target, tagBump]
  )

  const isServiceKey = (k: ABSApiKey): boolean => serviceUserIds.has(k.userId)
  const hiddenServiceCount = allKeys.filter(isServiceKey).length
  const keys = showServiceKeys ? allKeys : allKeys.filter((k) => !isServiceKey(k))

  const ownerName = (k: ABSApiKey): string =>
    k.user?.username ?? userById.get(k.userId)?.username ?? 'Unknown'

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const openCreate = () => {
    setNewName('')
    setOwnerId(me?.id ?? '')
    setExpiryIdx(0)
    setAsServiceAccount(false)
    setCreateError(null)
    setCreating(true)
  }

  const create = async () => {
    const name = newName.trim()
    const userId = ownerId || me?.id
    if (!name || !userId) return
    setCreateError(null)
    try {
      const res = await createApiKey(
        target,
        name,
        userId,
        EXPIRY_OPTIONS[expiryIdx]?.seconds
      )
      // Optionally group the owner under Service Accounts. ABS has no machine-user
      // flag, so "service account" is just our local per-server tag; applying it
      // here mirrors creating the key as a service account.
      if (asServiceAccount && !serviceUserIds.has(userId)) {
        tagServiceAccount(target, userId)
        setTagBump((n) => n + 1)
      }
      setCreatedToken(res.apiKey.apiKey ?? null)
      setCreating(false)
      qc.invalidateQueries({ queryKey: adminSectionKeys.apiKeys(target.serverId) })
    } catch (e) {
      // ABS 403s when a non-root admin targets a root user; surface its reason.
      setCreateError(
        e instanceof AbsError ? e.message : 'Could not create the key.'
      )
    }
  }
  const revoke = async (k: ABSApiKey) => {
    await deleteApiKey(target, k.id)
    qc.invalidateQueries({ queryKey: adminSectionKeys.apiKeys(target.serverId) })
  }

  return (
    <>
      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">API Keys</h1>
        </div>
        <button className="btn-sm btn-accent" onClick={openCreate}>
          <Icon name="add" /> New key
        </button>
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading keys..." />}
      {isError && <ErrorState message="Could not load API keys." onRetry={refetch} />}

      {data && hiddenServiceCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '0 0 14px',
          }}
        >
          <div
            className={'toggle' + (showServiceKeys ? ' on' : '')}
            role="switch"
            aria-checked={showServiceKeys}
            onClick={() => setShowServiceKeys((v) => !v)}
          >
            <i />
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Show service-account keys
            {!showServiceKeys && ` (${hiddenServiceCount} hidden)`}
          </span>
        </div>
      )}

      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>User</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600 }}>{k.name}</td>
                  <td>{ownerName(k)}</td>
                  <td className="num">
                    {fmtSessDate(new Date(k.createdAt).getTime()).day}
                  </td>
                  <td className="num">
                    {k.lastUsedAt ? fmtSessDate(k.lastUsedAt).day : 'never'}
                  </td>
                  <td>
                    {k.isActive ? (
                      <span style={{ color: '#a7c896' }}>Active</span>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>Inactive</span>
                    )}
                  </td>
                  <td>
                    <div className="t-actions">
                      <button
                        className="tbl-icon"
                        title="Revoke key"
                        onClick={() => setPendingRevoke(k)}
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal
          title="New API key"
          onClose={() => setCreating(false)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="btn-sm btn-green" onClick={() => void create()}>
                <Icon name="key" /> Create key
              </button>
            </>
          }
        >
          <div className="field full">
            <label>Key name</label>
            <input
              className="fld"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My script"
            />
          </div>
          <div className="field full">
            <label>User</label>
            <select
              className="fld"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                  {u.id === me?.id ? ' (you)' : ''}
                  {serviceUserIds.has(u.id)
                    ? ' - service account'
                    : u.type === 'root' || u.type === 'admin'
                      ? ` - ${u.type}`
                      : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              onClick={() => {
                // Already-tagged owners are service accounts no matter what; the
                // toggle only adds the tag, so keep it locked on for them.
                if (!serviceUserIds.has(ownerId)) setAsServiceAccount((v) => !v)
              }}
            >
              <div
                className={
                  'toggle' +
                  (asServiceAccount || serviceUserIds.has(ownerId) ? ' on' : '') +
                  (serviceUserIds.has(ownerId) ? ' disabled' : '')
                }
                role="switch"
                aria-checked={asServiceAccount || serviceUserIds.has(ownerId)}
              >
                <i />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {serviceUserIds.has(ownerId)
                  ? 'Owner is already a service account'
                  : 'This is a service account'}
              </span>
            </div>
          </div>
          <div className="field full">
            <label>Expires</label>
            <select
              className="fld"
              value={expiryIdx}
              onChange={(e) => setExpiryIdx(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o, i) => (
                <option key={o.label} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {createError && (
            <p style={{ fontSize: 13, color: 'var(--danger, #e57373)', margin: '4px 0 0' }}>
              {createError}
            </p>
          )}
        </Modal>
      )}

      {createdToken && (
        <Modal
          title="API key created"
          onClose={() => setCreatedToken(null)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn-sm btn-green"
                onClick={() => setCreatedToken(null)}
              >
                Done
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
            Copy this key now - it won't be shown again.
          </p>
          <div
            className="fld"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {createdToken}
          </div>
        </Modal>
      )}

      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke API key"
          message={`Revoke "${pendingRevoke.name}"? Anything using this key will stop working immediately.`}
          confirmLabel="Revoke key"
          danger
          onConfirm={() => void revoke(pendingRevoke)}
          onClose={() => setPendingRevoke(null)}
        />
      )}
    </>
  )
}
