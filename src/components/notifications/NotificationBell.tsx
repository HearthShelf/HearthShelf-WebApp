import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { respondToClubInvite } from '@/api/absClubs'
import {
  deleteAllNotifications,
  deleteNotification,
  findOwnedItemByAsin,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  type HSNotification,
} from '@/api/absNotifications'
import { Icon } from '@/components/common/Icon'
import { useActiveServer } from '@/hooks/useActiveServer'

function stringData(notification: HSNotification, key: string): string {
  const value = notification.data[key]
  return typeof value === 'string' ? value : ''
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function NotificationBell() {
  const { target } = useActiveServer()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const key = notificationKeys.list(target?.serverId ?? '')
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getNotifications(target!),
    enabled: Boolean(target),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ['clubs', target?.serverId] }),
    ])
  }
  const respond = useMutation({
    mutationFn: ({ notification, accept }: { notification: HSNotification; accept: boolean }) =>
      respondToClubInvite(
        target!,
        stringData(notification, 'clubId'),
        stringData(notification, 'inviteId') || notification.entityId,
        accept,
      ),
    onSuccess: async (_value, variables) => {
      await refresh()
      if (variables.accept) {
        setOpen(false)
        navigate(`/club/${stringData(variables.notification, 'clubId')}`)
      }
    },
  })
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(target!),
    onSuccess: refresh,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => deleteNotification(target!, id),
    onSuccess: refresh,
  })
  const clearAll = useMutation({
    mutationFn: () => deleteAllNotifications(target!),
    onSuccess: refresh,
  })

  const openNotification = (notification: HSNotification) => {
    if (!target) return
    if (!notification.readAt) {
      void markNotificationRead(target, notification.id)
        .then(refresh)
        .catch(() => {})
    }
    const clubId = stringData(notification, 'clubId')
    const asin = stringData(notification, 'asin')
    if (notification.kind === 'release' && asin) {
      setOpen(false)
      // 'available' means the book has LANDED in the library, so open the owned
      // book; the still-upcoming signals open the upcoming page. Falls back to
      // upcoming when the owned copy can't be resolved.
      if (stringData(notification, 'signal') === 'available') {
        void findOwnedItemByAsin(target, asin).then((itemId) =>
          navigate(
            itemId ? `/item/${encodeURIComponent(itemId)}` : `/upcoming/${encodeURIComponent(asin)}`,
          ),
        )
        return
      }
      navigate(`/upcoming/${encodeURIComponent(asin)}`)
      return
    }
    if (notification.kind === 'mention' && clubId) {
      setOpen(false)
      // ?note= scrolls the room to the comment and flashes it, so a mention
      // lands on the thing that was said rather than the top of the club.
      const noteId = stringData(notification, 'noteId')
      navigate(`/club/${clubId}${noteId ? `?note=${encodeURIComponent(noteId)}` : ''}`)
      return
    }
    if (notification.kind !== 'club_invite' && clubId) {
      setOpen(false)
      navigate(`/club/${clubId}`)
    }
  }

  const notifications = data?.notifications ?? []
  const unread = data?.unreadCount ?? 0
  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        type="button"
        className={'ab-ico notification-bell-button' + (open ? ' on' : '')}
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={unread ? 'notifications_active' : 'notifications'} fill={unread > 0} />
        {unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notification-tray" role="dialog" aria-label="Notifications">
          <div className="notification-tray-head">
            <div>
              <span className="eyebrow">Inbox</span>
              <strong>Notifications</strong>
            </div>
            {unread > 0 ? (
              <button type="button" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
                Mark all read
              </button>
            ) : notifications.length > 0 ? (
              <button type="button" disabled={clearAll.isPending} onClick={() => clearAll.mutate()}>
                Clear all
              </button>
            ) : null}
          </div>
          <div className="notification-tray-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">
                <Icon name="notifications_none" />
                <strong>Nothing new</strong>
                <span>Invitations, club updates, and release alerts will appear here.</span>
              </div>
            ) : (
              notifications.map((notification) => {
                const pending =
                  notification.kind === 'club_invite' && notification.actionStatus === 'pending'
                return (
                  <article
                    key={notification.id}
                    className={'notification-row' + (!notification.readAt ? ' unread' : '')}
                    onClick={() => openNotification(notification)}
                  >
                    <span className="notification-kind">
                      <Icon
                        name={
                          notification.kind === 'club_invite'
                            ? 'group_add'
                            : notification.kind === 'release'
                              ? 'new_releases'
                              : notification.kind === 'mention'
                                ? 'alternate_email'
                                : 'notifications'
                        }
                      />
                    </span>
                    <div>
                      <div className="notification-row-title">
                        <strong>{notification.title}</strong>
                        <time>{relativeTime(notification.createdAt)}</time>
                      </div>
                      {notification.body && <p>{notification.body}</p>}
                      {pending ? (
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="pill on"
                            disabled={respond.isPending}
                            onClick={(event) => {
                              event.stopPropagation()
                              respond.mutate({ notification, accept: true })
                            }}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="pill"
                            disabled={respond.isPending}
                            onClick={(event) => {
                              event.stopPropagation()
                              respond.mutate({ notification, accept: false })
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      ) : notification.kind === 'club_invite' ? (
                        <span className="notification-status">
                          {notification.actionStatus === 'accepted'
                            ? 'Joined'
                            : notification.actionStatus === 'declined'
                              ? 'Declined'
                              : 'No longer available'}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="ab-ico notification-dismiss"
                      title="Dismiss"
                      aria-label={`Dismiss ${notification.title}`}
                      disabled={dismiss.isPending}
                      onClick={(event) => {
                        event.stopPropagation()
                        dismiss.mutate(notification.id)
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </article>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
