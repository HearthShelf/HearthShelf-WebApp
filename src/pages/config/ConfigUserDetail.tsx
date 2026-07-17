import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUsers,
  updateUser,
  adminKeys,
  adminSectionKeys,
  getUserListeningStats,
  getUserListeningSessions,
} from '@/api/absAdmin'
import { getLinkedAbsUserIds, hostedKeys } from '@/api/absHosted'
import { EditUserAccountModal, type EditUserAccountValues } from '@/components/config/EditUserAccountModal'
import { ChangePasswordModal } from '@/components/config/ChangePasswordModal'
import { EditPermissionsModal, type EditPermissionsValues } from '@/components/config/EditPermissionsModal'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fmtSessDate, formatDuration, computeListeningStats } from '@hearthshelf/core'
import { Cover, tintFor } from '@/components/shared/Cover'
import { DeviceKindIcon } from '@/components/common/DeviceKindIcon'
import { Icon } from '@/components/common/Icon'
import { Avatar } from '@/components/common/Avatar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'

type EditMode = 'account' | 'password' | 'permissions' | null

export function ConfigUserDetail({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  // Box-local: which ABS users have signed in via app.hearthshelf.com. Failure
  // (unpaired, older box) just means we can't show link status - not an error.
  const { data: linkedIds } = useQuery({
    queryKey: hostedKeys.linkedUsers(target?.serverId ?? ''),
    queryFn: () => getLinkedAbsUserIds(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
  })

  // Per-user listening reads (admin-scoped ABS endpoints). Sessions double as
  // the "last seen" source: ABS only stamps user.lastSeen on websocket auth,
  // which REST-only HearthShelf clients never trigger.
  const { data: stats } = useQuery({
    queryKey: adminSectionKeys.userStats(target?.serverId ?? '', userId),
    queryFn: () => getUserListeningStats(target!, userId),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
  })
  const [sessPage, setSessPage] = useState(0)
  const { data: sessions } = useQuery({
    queryKey: adminSectionKeys.userSessions(target?.serverId ?? '', userId, sessPage),
    queryFn: () => getUserListeningSessions(target!, userId, sessPage),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
    placeholderData: (prev) => prev,
  })

  const user = data?.users.find((u) => u.id === userId)

  if (!target || isLoading) {
    return <LoadingSpinner className="py-12" label="Loading user..." />
  }
  if (!user) {
    return (
      <div className="empty-state">
        <Icon name="person_off" />
        <h3>User not found</h3>
      </div>
    )
  }

  const linkedToHosted = linkedIds?.has(user.id) ?? false

  // Fold the raw ABS stats payload into the computed shape (streak, active
  // days, most-listened) with the same math the Stats page uses.
  const hs = stats ? computeListeningStats(stats, new Date()) : null
  const topBooks = hs?.mostListened.slice(0, 5) ?? []
  const topMax = topBooks[0]?.timeSec || 1

  // Show only the boolean permission flags that are enabled (skip the array
  // fields librariesAccessible / itemTagsSelected, which aren't simple toggles).
  const perms = Object.entries(user.permissions ?? {}).filter(([, v]) => v === true)
  // Prefer real playback activity over ABS's websocket-only lastSeen stamp.
  const newestSess = sessPage === 0 ? sessions?.sessions[0] : undefined
  const lastActive = Math.max(
    user.lastSeen ?? 0,
    newestSess ? newestSess.updatedAt || newestSess.startedAt || 0 : 0,
  )
  const seen = lastActive > 0 ? fmtSessDate(lastActive) : null

  const closeEdit = () => {
    setEditMode(null)
    setFormError(null)
  }

  const saveAccount = async (values: EditUserAccountValues) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, values)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Changes saved')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async (password: string) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, { password })
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Password changed')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not change password')
    } finally {
      setBusy(false)
    }
  }

  const savePermissions = async (values: EditPermissionsValues) => {
    setBusy(true)
    setFormError(null)
    try {
      await updateUser(target, user.id, values)
      qc.invalidateQueries({ queryKey: adminKeys.users(target.serverId) })
      closeEdit()
      show('Permissions saved')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save permissions')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="crumb">
        <Link className="lnk" to="/config/users">
          Users
        </Link>
        <Icon name="chevron_right" />
        {user.username}
      </div>

      <div className="page-head-row">
        <div>
          <div className="eyebrow">Admin · User</div>
          <h1 className="title-xl">{user.username}</h1>
        </div>
        <div className="t-actions">
          <button className="btn-sm btn-ghost" onClick={() => setEditMode('permissions')}>
            <Icon name="key" /> Edit permissions
          </button>
          <button className="btn-sm btn-ghost" onClick={() => setEditMode('password')}>
            <Icon name="lock_reset" /> Reset password
          </button>
          <button className="btn-sm btn-accent" onClick={() => setEditMode('account')}>
            <Icon name="edit" /> Edit user account
          </button>
        </div>
      </div>

      <div className="cfg-card" style={{ marginBottom: 18 }}>
        <div className="cfg-line">
          <Icon name="account_circle" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta">
            <div className="cl-t">Profile</div>
          </div>
          <Avatar name={user.username} size={48} />
        </div>
      </div>

      <div className="cfg-card">
        {(
          [
            ['badge', 'Type', user.type],
            ['email', 'Email', user.email ?? '—'],
            ['toggle_on', 'Status', user.isActive ? 'Active' : 'Disabled'],
            ['lock', 'Locked', user.isLocked ? 'Yes' : 'No'],
            [
              'link',
              'hearthshelf.com account',
              linkedToHosted ? 'Connected' : 'Not connected',
            ],
            ['schedule', 'Last seen', seen ? `${seen.day} · ${seen.time}` : 'never'],
            ['calendar_today', 'Created', fmtSessDate(user.createdAt).day],
          ] as [string, string, string][]
        ).map(([icon, label, value]) => (
          <div className="cfg-line" key={label}>
            <Icon name={icon} style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta">
              <div className="cl-t">{label}</div>
            </div>
            <span
              style={{ color: label === 'hearthshelf.com account' && linkedToHosted ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {perms.length > 0 && (
        <>
          <div className="section-head">
            <Icon name="key" />
            <h2>Permissions</h2>
          </div>
          <div className="meta-chips">
            {perms.map(([k]) => (
              <span className="chip" key={k}>
                <Icon name="check" /> {k.replace(/^can/, '')}
              </span>
            ))}
          </div>
        </>
      )}

      {hs && hs.totalTimeSec > 0 && (
        <>
          <div className="section-head">
            <Icon name="headphones" />
            <h2>Listening stats</h2>
          </div>
          <div className="stat-tiles">
            <div className="tile">
              <div className="t-ico">
                <Icon name="schedule" />
              </div>
              <div className="t-num">{formatDuration(hs.totalTimeSec)}</div>
              <div className="t-cap">Total time</div>
            </div>
            <div className="tile">
              <div className="t-ico">
                <Icon name="menu_book" />
              </div>
              <div className="t-num">{hs.mostListened.length}</div>
              <div className="t-cap">Books listened</div>
            </div>
            <div className="tile">
              <div className="t-ico">
                <Icon name="calendar_today" />
              </div>
              <div className="t-num">{hs.activeDays}</div>
              <div className="t-cap">Active days</div>
            </div>
            {hs.dayStreak > 0 && (
              <div className="tile">
                <div
                  className="t-ico"
                  style={{
                    background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Icon name="local_fire_department" fill />
                </div>
                <div className="t-num">{hs.dayStreak}</div>
                <div className="t-cap">Day streak</div>
              </div>
            )}
            <div className="tile">
              <div className="t-ico">
                <Icon name="date_range" />
              </div>
              <div className="t-num">{formatDuration(hs.weekSec)}</div>
              <div className="t-cap">This week</div>
            </div>
            <div className="tile">
              <div className="t-ico" style={hs.todaySec > 0 ? {
                background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
                color: 'var(--accent)',
              } : undefined}>
                <Icon name="today" fill={hs.todaySec > 0} />
              </div>
              <div className="t-num">{formatDuration(hs.todaySec)}</div>
              <div className="t-cap">Today</div>
            </div>
          </div>

          {topBooks.length > 0 && (
            <>
              <div className="section-head">
                <Icon name="trending_up" />
                <h2>Most listened to</h2>
              </div>
              <div className="chart-card" style={{ marginTop: 0 }}>
                <div className="ml-list">
                  {topBooks.map((b, i) => (
                    <div className="ml-row" key={b.id} data-cv={tintFor(b.title)}>
                      <span className="ml-rank">{i + 1}</span>
                      <Cover itemId={b.id} title={b.title} fs={4} />
                      <div className="ml-meta">
                        <div className="ml-t">{b.title}</div>
                        <div className="ml-s">
                          {[b.author, b.narrator].filter(Boolean).join(' · ')}
                        </div>
                        <div className="ml-bar">
                          <i style={{ width: (b.timeSec / topMax) * 100 + '%' }} />
                        </div>
                      </div>
                      <span className="ml-h">
                        {(b.timeSec / 3600).toFixed(1)}
                        <small>h</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {sessions && sessions.total > 0 && (
        <>
          <div className="section-head">
            <Icon name="history" />
            <h2>Recent sessions</h2>
          </div>
          <div className="cfg-card">
            {sessions.sessions.map((s) => {
              const when = fmtSessDate(s.updatedAt || s.startedAt)
              return (
                <div className="cfg-line" key={s.id}>
                  <DeviceKindIcon
                    deviceInfo={s.deviceInfo}
                    size={18}
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <div className="cl-meta">
                    <div className="cl-t">{s.displayTitle}</div>
                    <div className="cl-d">
                      {[s.displayAuthor, formatDuration(s.timeListening)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {when.day} · {when.time}
                  </span>
                </div>
              )
            })}
          </div>
          {sessions.numPages > 1 && (
            <div className="t-actions" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn-sm btn-ghost"
                disabled={sessPage === 0}
                onClick={() => setSessPage((p) => Math.max(0, p - 1))}
              >
                <Icon name="chevron_left" /> Newer
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }}>
                {sessPage + 1} / {sessions.numPages}
              </span>
              <button
                className="btn-sm btn-ghost"
                disabled={sessPage + 1 >= sessions.numPages}
                onClick={() => setSessPage((p) => p + 1)}
              >
                Older <Icon name="chevron_right" />
              </button>
            </div>
          )}
        </>
      )}

      {editMode === 'account' && (
        <EditUserAccountModal
          user={user}
          linkedToHosted={linkedToHosted}
          busy={busy}
          error={formError}
          onSubmit={(v) => void saveAccount(v)}
          onClose={closeEdit}
        />
      )}

      {editMode === 'password' && (
        <ChangePasswordModal
          user={user}
          busy={busy}
          error={formError}
          onSubmit={(v) => void savePassword(v)}
          onClose={closeEdit}
        />
      )}

      {editMode === 'permissions' && (
        <EditPermissionsModal
          target={target}
          user={user}
          busy={busy}
          error={formError}
          onSubmit={(v) => void savePermissions(v)}
          onClose={closeEdit}
        />
      )}
    </>
  )
}
